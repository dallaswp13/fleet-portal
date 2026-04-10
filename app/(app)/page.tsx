import { createClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'
import DashboardCharts from '@/components/DashboardCharts'
import DashboardStats from '@/components/DashboardStats'
import { SMSActivityFeed, IssueTrackerSummary, VerizonUsageAlerts, FleetTrendChart } from '@/components/DashboardWidgets'
import { getOfficesFromParam, getTabsFromParam, getAscFleetsFromParam, getFleetIdsFromFilters, OFFICES, SHEET_TABS } from '@/lib/filters'

interface SearchParams { offices?: string; tabs?: string; asc_fleets?: string }

const USAGE_ALERT_THRESHOLD = 5 // GB — lines above this show in alerts

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params  = await searchParams
  const offices = getOfficesFromParam(params.offices)
  const tabs    = getTabsFromParam(params.tabs)
  const ascFleets  = getAscFleetsFromParam(params.asc_fleets)
  const fleetIds   = getFleetIdsFromFilters(offices, ascFleets)
  const allOffices = fleetIds === null
  const allTabs    = tabs.length === SHEET_TABS.length

  const supabase = await createClient()

  // Base vehicle query with office + tab filters applied
  function vehicleQuery() {
    let q = supabase.from('vehicles').select('*', { count: 'exact', head: true })
    if (fleetIds !== null) {
      if (fleetIds.length === 0) q = q.eq('vehicle_number', -1)
      else q = q.in('fleet_id', fleetIds)
    }
    if (!allTabs) q = q.in('sheet_tab', tabs)
    return q
  }

  const [
    { count: totalVehicles },
    { count: online },
    { count: offline },
    { count: inactive },
    { count: totalDevices },
    { count: totalLines },
    { data: recentAudit },
    { data: usageData },
    // New widget data
    { data: recentSms },
    { count: smsTodayCount },
    { count: smsUnprocessedCount },
    { data: openIssues },
    { data: verizonAlertData },
    { data: suspendedLines },
    { data: trendData },
  ] = await Promise.all([
    vehicleQuery(),
    vehicleQuery().ilike('online_status', 'Online%'),
    vehicleQuery().ilike('online_status', 'Offline%'),
    vehicleQuery().not('online_status', 'ilike', 'Online%').not('online_status', 'ilike', 'Offline%'),
    // Devices: count distinct devices linked to vehicles in the selected offices
    (() => {
      let q = supabase.from('fleet_overview').select('device_id', { count: 'exact', head: true }).not('device_id', 'is', null)
      if (fleetIds !== null) {
        if (fleetIds.length === 0) q = q.eq('vehicle_number', -1)
        else q = q.in('fleet_id', fleetIds)
      }
      if (!allTabs) q = q.in('sheet_tab', tabs)
      return q
    })(),
    // Verizon lines filtered by office
    (() => {
      let q = supabase.from('verizon_lines').select('*', { count: 'exact', head: true })
      if (!allOffices) q = q.in('office', offices)
      return q
    })(),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(8),
    // Top usage by device name via fleet_overview
    (() => {
      let q = supabase
        .from('fleet_overview')
        .select('vehicle_number,fleet_id,office,device_name,pim_device_name,monthly_usage_gb,pim_monthly_usage_gb')
        .not('monthly_usage_gb', 'is', null)
        .order('monthly_usage_gb', { ascending: false })
        .limit(20)
      if (fleetIds !== null) {
        if (fleetIds.length === 0) q = q.eq('vehicle_number', -1)
        else q = q.in('fleet_id', fleetIds)
      }
      if (!allTabs) q = q.in('sheet_tab', tabs)
      return q
    })(),

    // ── SMS Activity Feed ──
    supabase.from('sms_messages')
      .select('sender,sms_text,received_at,action,success')
      .order('received_at', { ascending: false })
      .limit(8),
    supabase.from('sms_messages')
      .select('*', { count: 'exact', head: true })
      .gte('received_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
    supabase.from('sms_messages')
      .select('*', { count: 'exact', head: true })
      .eq('processed', false),

    // ── Issue Tracker Summary ──
    supabase.from('issues')
      .select('id,title,priority,created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50),

    // ── Verizon Alerts: high usage ──
    supabase.from('verizon_lines')
      .select('phone_number,verizon_user,monthly_usage_gb,phone_status,office')
      .gte('monthly_usage_gb', USAGE_ALERT_THRESHOLD)
      .order('monthly_usage_gb', { ascending: false })
      .limit(20),
    // Suspended lines
    supabase.from('verizon_lines')
      .select('phone_number,verizon_user,monthly_usage_gb,phone_status,office')
      .ilike('phone_status', '%suspend%')
      .limit(20),

    // ── Fleet Trend Data ──
    supabase.from('daily_snapshots')
      .select('snapshot_date,online_count,offline_count,inactive_count,device_count,open_issues')
      .order('snapshot_date', { ascending: true })
      .limit(90),
  ])

  // Also fire-and-forget a snapshot record for today
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    if (baseUrl) {
      const snapshotUrl = baseUrl.startsWith('http') ? `${baseUrl}/api/snapshot` : `https://${baseUrl}/api/snapshot`
      fetch(snapshotUrl, { method: 'POST' }).catch(() => {})
    }
  } catch { /* ignore */ }

  // Build top usage list from fleet_overview (device-centric, combined driver+PIM)
  type UsageRow = { vehicle_number: number | null; fleet_id: string | null; device_name: string | null; pim_device_name: string | null; monthly_usage_gb: number | null; pim_monthly_usage_gb: number | null; office: string | null }
  const topUsage = ((usageData ?? []) as unknown as UsageRow[])
    .map(r => ({
      device:        r.device_name ?? r.pim_device_name ?? `#${r.vehicle_number}${r.fleet_id ?? ''}`,
      vehicle:       r.vehicle_number ? `${r.vehicle_number}${(r.fleet_id ?? '').toUpperCase()}` : '',
      vehicleNumber: r.vehicle_number ?? null,
      gb:            (Number(r.monthly_usage_gb ?? 0)) + (Number(r.pim_monthly_usage_gb ?? 0)),
      office:        r.office ?? '',
    }))
    .sort((a, b) => b.gb - a.gb)
    .slice(0, 8)

  const stats = [
    { label: 'Total Vehicles', value: totalVehicles ?? 0, sub: allOffices && allTabs ? 'All fleet records' : 'Filtered', href: '/vehicles' },
    { label: 'Online',         value: online   ?? 0, sub: 'Active right now',   color: 'var(--green)', href: '/vehicles' },
    { label: 'Offline',        value: offline  ?? 0, sub: 'Not reporting',       color: 'var(--amber)', href: '/vehicles' },
    { label: 'Inactive',       value: inactive ?? 0, sub: 'Surrendered / idle',  color: 'var(--text3)', href: '/vehicles' },
    { label: 'Devices',        value: totalDevices  ?? 0, sub: 'MaaS360 managed', href: '/devices' },
    { label: 'Verizon Lines',  value: totalLines    ?? 0, sub: allOffices ? 'All SIM cards' : 'Filtered', href: '/lines' },
  ]

  const ACTION_LABELS: Record<string, string> = {
    reboot: '↺ Reboot', wipe: '⚠ Wipe', kiosk_enter: '⬛ Kiosk On',
    kiosk_exit: '⬜ Kiosk Off', clear_app_data: '🗑 Clear Data',
    import_ccsi: '📊 Import CCSI', import_devices: '📱 Import Devices', import_verizon: '📡 Import Verizon',
  }

  // ── Build SMS Activity data ──
  const smsActivity = {
    recentMessages: (recentSms ?? []).map((m: Record<string, unknown>) => ({
      sender:      String(m.sender ?? ''),
      sms_text:    String(m.sms_text ?? ''),
      received_at: String(m.received_at ?? ''),
      action:      m.action as string | null,
      success:     m.success as boolean | null,
    })),
    totalToday:       smsTodayCount ?? 0,
    unprocessedCount: smsUnprocessedCount ?? 0,
  }

  // ── Build Issue Tracker Summary ──
  const issuesList = (openIssues ?? []) as { id: string; title: string; priority: string; created_at: string }[]
  const issueSummary = {
    highCount:   issuesList.filter(i => i.priority === 'high').length,
    mediumCount: issuesList.filter(i => i.priority === 'medium' || i.priority === 'normal').length,
    lowCount:    issuesList.filter(i => i.priority === 'low').length,
    totalOpen:   issuesList.length,
    newest:      issuesList.slice(0, 4),
  }

  // ── Build Verizon Alerts ──
  type VzRow = { phone_number: string; verizon_user: string | null; monthly_usage_gb: number | null; phone_status: string | null; office: string | null }
  const verizonAlerts = [
    ...(suspendedLines ?? []).map((l: VzRow) => ({ ...l, alertType: 'suspended' as const })),
    ...(verizonAlertData ?? []).map((l: VzRow) => ({ ...l, alertType: 'high_usage' as const })),
  ]

  // ── Build Trend Data ──
  type SnapRow = { snapshot_date: string; online_count: number; offline_count: number; inactive_count: number; device_count: number; open_issues: number }
  const trendPoints = ((trendData ?? []) as SnapRow[]).map(s => ({
    date:       s.snapshot_date,
    online:     s.online_count,
    offline:    s.offline_count,
    inactive:   s.inactive_count,
    devices:    s.device_count,
    openIssues: s.open_issues,
  }))

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>
            {allOffices ? 'All offices' : (fleetIds ?? []).join(', ')}
            {' · '}
            {allTabs ? 'All vehicles' : tabs.map(t => t === 'Active Vehicles' ? 'Active' : t === 'Test Vehicles' ? 'Test' : 'Surrendered').join(', ')}
          </p>
        </div>
      </div>

      <DashboardStats stats={stats} />

      <DashboardCharts
        fleetStatus={{ online: online ?? 0, offline: offline ?? 0, inactive: inactive ?? 0 }}
        topUsage={topUsage}
      />

      {/* New widget row: SMS · Issues · Verizon Alerts */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
        <SMSActivityFeed data={smsActivity} />
        <IssueTrackerSummary data={issueSummary} />
        <VerizonUsageAlerts alerts={verizonAlerts} usageThreshold={USAGE_ALERT_THRESHOLD} />
      </div>

      {/* Fleet Trend Chart */}
      <FleetTrendChart data={trendPoints} />

      {/* Recent Actions */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>Recent Actions</h2>
          <a href="/settings?tab=audit" style={{ fontSize: 12, color: 'var(--accent)' }}>View all →</a>
        </div>
        {recentAudit && recentAudit.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Action</th><th>Vehicle</th><th>Target</th><th>User</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentAudit.map(log => (
                  <tr key={log.id}>
                    <td className="mono text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td><span className={`badge ${log.action === 'wipe' ? 'badge-red' : log.action?.startsWith('import') ? 'badge-blue' : 'badge-gray'}`}>{ACTION_LABELS[log.action] ?? log.action}</span></td>
                    <td>{log.vehicle_number ? <span className="tag">#{log.vehicle_number}</span> : <span className="text-dim">—</span>}</td>
                    <td className="mono truncate" style={{ maxWidth: 180, fontSize: 11 }}>{log.target_id}</td>
                    <td className="text-dim truncate" style={{ maxWidth: 160, fontSize: 11 }}>{log.user_email}</td>
                    <td><span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>{log.success ? '✓ OK' : '✗ Failed'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No actions logged yet.</div>
        )}
      </div>
    </div>
  )
}
