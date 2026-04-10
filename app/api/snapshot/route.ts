import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })

  const service = createClient(url, key)

  // Try calling the RPC first (requires migration 028)
  const { error: rpcError } = await service.rpc('record_daily_snapshot')

  if (rpcError) {
    // Fallback: manually compute and insert if RPC doesn't exist yet
    if (rpcError.message.includes('record_daily_snapshot')) {
      const today = new Date().toISOString().slice(0, 10)

      const [
        { count: onlineCount },
        { count: offlineCount },
        { count: deviceCount },
        { count: lineCount },
        { count: openIssues },
      ] = await Promise.all([
        service.from('vehicles').select('*', { count: 'exact', head: true }).ilike('online_status', 'Online%'),
        service.from('vehicles').select('*', { count: 'exact', head: true }).ilike('online_status', 'Offline%'),
        service.from('devices').select('*', { count: 'exact', head: true }),
        service.from('verizon_lines').select('*', { count: 'exact', head: true }),
        service.from('issues').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      ])
      const { count: totalVehicles } = await service.from('vehicles').select('*', { count: 'exact', head: true })
      const inactiveCount = (totalVehicles ?? 0) - (onlineCount ?? 0) - (offlineCount ?? 0)

      const { error: insertError } = await service.from('daily_snapshots').upsert({
        snapshot_date: today,
        online_count: onlineCount ?? 0,
        offline_count: offlineCount ?? 0,
        inactive_count: inactiveCount,
        device_count: deviceCount ?? 0,
        open_issues: openIssues ?? 0,
        line_count: lineCount ?? 0,
      }, { onConflict: 'snapshot_date' })

      if (insertError) {
        // Table may not exist yet — that's ok
        return NextResponse.json({ ok: true, note: 'Snapshot table not yet created (run migration 028)' })
      }
      return NextResponse.json({ ok: true, method: 'fallback' })
    }
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, method: 'rpc' })
}
