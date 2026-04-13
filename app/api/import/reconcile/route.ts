/**
 * Fleet Reconciliation — CCSI.xlsx as source of truth.
 *
 * Compares a freshly-uploaded CCSI workbook against the `vehicles` table and
 * reports three buckets:
 *   • newVehicles     — in CCSI, not in DB (need INSERT)
 *   • missingVehicles — in DB, not in CCSI (ghost records; should be moved to
 *                        Surrenders or deleted depending on policy)
 *   • tabChanges      — (vehicle_number, fleet_id) exists in both, but
 *                        sheet_tab differs (e.g., Active → Surrenders)
 *
 * Default response is a **dry-run** diff. The client must post again with
 * `mode=apply` to actually persist changes. Applying will:
 *   • UPSERT the newVehicles rows
 *   • UPDATE sheet_tab for tabChanges
 *   • For missingVehicles, mark sheet_tab='Surrenders' (conservative — we
 *     never DELETE fleet records from this endpoint)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'
import { parseCCSI, type ReconcileDiff } from '@/lib/ccsi'

export const dynamic = 'force-dynamic'

type Mode = 'dry-run' | 'apply'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const svc = await createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const mode = ((formData.get('mode') as string) ?? 'dry-run') as Mode
  if (!file) return NextResponse.json({ error: 'No CCSI file uploaded' }, { status: 400 })
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Expected an .xlsx CCSI workbook' }, { status: 400 })
  }

  const buffer = await file.arrayBuffer()
  let ccsiRecords
  try {
    const parsed = await parseCCSI(buffer)
    ccsiRecords = parsed.records
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to parse CCSI.xlsx'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // Pull existing DB state (vehicle_number, fleet_id, sheet_tab only).
  // Supabase's REST layer caps any single SELECT at 1000 rows regardless of
  // .select() — paginate with .range() until we've exhausted the table.
  type DbRow = { vehicle_number: number; fleet_id: string; sheet_tab: string | null }
  const dbMap = new Map<string, DbRow>()
  const PAGE = 1000
  for (let start = 0; ; start += PAGE) {
    const { data: dbRows, error: dbErr } = await svc
      .from('vehicles')
      .select('vehicle_number, fleet_id, sheet_tab')
      .range(start, start + PAGE - 1)
    if (dbErr) return NextResponse.json({ error: `DB read failed: ${dbErr.message}` }, { status: 500 })
    const batch = (dbRows ?? []) as DbRow[]
    for (const r of batch) dbMap.set(`${r.vehicle_number}|${r.fleet_id}`, r)
    if (batch.length < PAGE) break
    // Safety stop in case something is catastrophically wrong — no fleet has 50k+ vehicles
    if (start > 50_000) break
  }

  const ccsiMap = new Map<string, typeof ccsiRecords[number]>()
  for (const r of ccsiRecords) ccsiMap.set(`${r.vehicle_number}|${r.fleet_id}`, r)

  // Bucket the diff
  const diff: ReconcileDiff = {
    newVehicles: [],
    missingVehicles: [],
    tabChanges: [],
    unchangedCount: 0,
    ccsiCount: ccsiRecords.length,
    dbCount: dbMap.size,
  }

  for (const [key, rec] of ccsiMap.entries()) {
    const db = dbMap.get(key)
    if (!db) {
      diff.newVehicles.push(rec)
    } else if ((db.sheet_tab ?? '') !== rec.sheet_tab) {
      diff.tabChanges.push({
        vehicle_number: rec.vehicle_number,
        fleet_id: rec.fleet_id,
        from: db.sheet_tab,
        to: rec.sheet_tab,
      })
    } else {
      diff.unchangedCount++
    }
  }

  for (const [key, row] of dbMap.entries()) {
    if (!ccsiMap.has(key)) {
      diff.missingVehicles.push({
        vehicle_number: row.vehicle_number,
        fleet_id: row.fleet_id,
        sheet_tab: row.sheet_tab,
      })
    }
  }

  if (mode === 'dry-run') {
    return NextResponse.json({
      ok: true,
      mode: 'dry-run',
      filename: file.name,
      diff,
    })
  }

  // ── APPLY ─────────────────────────────────────────────────────────────────
  const applied = { inserted: 0, tabUpdated: 0, surrendered: 0, errors: [] as string[] }

  // 1) Upsert new vehicles (full rows)
  if (diff.newVehicles.length > 0) {
    const BATCH = 200
    for (let i = 0; i < diff.newVehicles.length; i += BATCH) {
      const slice = diff.newVehicles.slice(i, i + BATCH)
      const { error } = await svc
        .from('vehicles')
        .upsert(slice as unknown as Record<string, unknown>[], { onConflict: 'vehicle_number,fleet_id' })
      if (error) applied.errors.push(`insert batch ${i}: ${error.message}`)
      else applied.inserted += slice.length
    }
  }

  // 2) Tab changes — only touch sheet_tab + updated_at
  for (const chg of diff.tabChanges) {
    const { error } = await svc
      .from('vehicles')
      .update({ sheet_tab: chg.to, updated_at: new Date().toISOString() })
      .eq('vehicle_number', chg.vehicle_number)
      .eq('fleet_id', chg.fleet_id)
    if (error) applied.errors.push(`tab ${chg.vehicle_number}${chg.fleet_id}: ${error.message}`)
    else applied.tabUpdated++
  }

  // 3) Missing in CCSI — mark as Surrendered (never delete from here).
  //    Skip if already marked Surrenders to avoid spurious updates.
  for (const m of diff.missingVehicles) {
    if ((m.sheet_tab ?? '') === 'Surrenders') continue
    const { error } = await svc
      .from('vehicles')
      .update({ sheet_tab: 'Surrenders', updated_at: new Date().toISOString() })
      .eq('vehicle_number', m.vehicle_number)
      .eq('fleet_id', m.fleet_id)
    if (error) applied.errors.push(`surrender ${m.vehicle_number}${m.fleet_id}: ${error.message}`)
    else applied.surrendered++
  }

  await writeAuditLog({
    userEmail: user.email!,
    action: 'reconcile_ccsi',
    targetType: 'device',
    targetId: file.name,
    payload: { filename: file.name, size: file.size, counts: { ccsi: diff.ccsiCount, db: diff.dbCount } },
    result: applied,
    success: applied.errors.length === 0,
  }).catch(() => {})

  return NextResponse.json({
    ok: applied.errors.length === 0,
    mode: 'apply',
    filename: file.name,
    diff,
    applied,
  })
}
