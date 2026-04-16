import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Audit Log API — supports filtered queries and CSV export.
 *
 *   GET  → paginated, filterable audit log
 *     Query params:
 *       page        (int, default 0)
 *       per_page    (int, default 50, max 500)
 *       action      (comma-separated action types, e.g. "reboot,wipe")
 *       target_type (comma-separated, e.g. "device,inventory")
 *       date_from   (ISO date string, inclusive)
 *       date_to     (ISO date string, inclusive end-of-day)
 *       format      (optional: "csv" to download as CSV)
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl
  const page     = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10))
  const perPage  = Math.min(500, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '50', 10)))
  const actions  = url.searchParams.get('action')?.split(',').filter(Boolean) ?? []
  const types    = url.searchParams.get('target_type')?.split(',').filter(Boolean) ?? []
  const dateFrom = url.searchParams.get('date_from') ?? ''
  const dateTo   = url.searchParams.get('date_to') ?? ''
  const format   = url.searchParams.get('format') ?? ''

  // For CSV export, fetch up to 10,000 rows without pagination
  const isCSV = format === 'csv'
  const limit = isCSV ? 10000 : perPage

  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  // Apply filters
  if (actions.length > 0) {
    query = query.in('action', actions)
  }
  if (types.length > 0) {
    query = query.in('target_type', types)
  }
  if (dateFrom) {
    query = query.gte('created_at', dateFrom)
  }
  if (dateTo) {
    // End of day
    const endDate = new Date(dateTo)
    endDate.setHours(23, 59, 59, 999)
    query = query.lte('created_at', endDate.toISOString())
  }

  if (!isCSV) {
    query = query.range(page * perPage, (page + 1) * perPage - 1)
  } else {
    query = query.limit(limit)
  }

  const { data: logs, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (isCSV) {
    const rows = (logs ?? [])
    const headers = ['Timestamp', 'Action', 'Target Type', 'Target ID', 'Vehicle #', 'User', 'Success', 'Payload', 'Result']
    const csvLines = [
      headers.join(','),
      ...rows.map(r => [
        `"${new Date(r.created_at).toISOString()}"`,
        `"${r.action ?? ''}"`,
        `"${r.target_type ?? ''}"`,
        `"${r.target_id ?? ''}"`,
        r.vehicle_number ?? '',
        `"${r.user_email ?? ''}"`,
        r.success ? 'true' : 'false',
        `"${JSON.stringify(r.payload ?? {}).replace(/"/g, '""')}"`,
        `"${JSON.stringify(r.result ?? {}).replace(/"/g, '""')}"`,
      ].join(','))
    ]
    return new NextResponse(csvLines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit_log_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  // Also return distinct action types and target types for filter dropdowns
  const { data: actionTypes } = await supabase
    .from('audit_log')
    .select('action')
    .limit(200)
  const { data: targetTypes } = await supabase
    .from('audit_log')
    .select('target_type')
    .limit(200)

  const uniqueActions = [...new Set((actionTypes ?? []).map(r => r.action).filter(Boolean))].sort()
  const uniqueTypes = [...new Set((targetTypes ?? []).map(r => r.target_type).filter(Boolean))].sort()

  return NextResponse.json({
    logs: logs ?? [],
    count: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
    filterOptions: { actions: uniqueActions, targetTypes: uniqueTypes },
  })
}
