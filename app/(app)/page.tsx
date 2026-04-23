import { createClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'
import DashboardCharts from '@/components/DashboardCharts'
import DashboardStats from '@/components/DashboardStats'
import QuickActions from '@/components/QuickActions'
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

  // Resolve vehicle_name_keys + device count in a single chained async so
  // they run in parallel with the other dashboard queries (previously the
  // name_key fetch ran serially before Promise.all, adding ~200-400ms).
  async function fetchDeviceCount(): Promise<{ count: number | null }> {
    let nameKeys: string[] | null = null
    if (fleetIds !== null) {
      let vq = supabase.from('vehicles').select('vehicle_name_key').not('vehicle_name_key', 'is', null)
      if (fleetIds.length === 0) vq = vq.eq('vehicle_number', -1)
      else vq = vq.in('fleet_id', fleetIds)
      const { data: vehs } = await vq
      nameKeys = (vehs ?? []).map(v => v.vehicle_name_key as string)
    }
    const q = supabase.from('devices').select('*', { count: 'exact', head: true })
    if (nameKeys !== null) {
      if (nameKeys.length === 0) return q.eq('name_key', '___NO_MATCH___')
      return q.in('name_key', nameKeys)
    }
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
  ] = await Promise.all([
    vehicleQuery(),
    vehicleQuery().ilike('online_status', 'Online%'),
    vehicleQuery().ilike('online_status', 'Offline%'),
    vehicleQuery().not('online_status', 'ilike', 'Online%').not('online_status', 'ilike', 'Offline%'),
    // Devices: chained fetch — resolves name_keys then counts devices.
    // Runs in parallel with all other queries above/below.
    fetchDeviceCount(),
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
  ])

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
    { label: 'Total Vehicles', value: totalVehicles ?? 0, sub: allOffices && allTabs ? 'All fleet records' : 'Filtered', href: '/fleet/vehicles' },
    { label: 'Online',         value: online   ?? 0, sub: 'Active right now',   color: 'var(--green)', href: '/fleet/vehicles' },
    { label: 'Offline',        value: offline  ?? 0, sub: 'Not reporting',       color: 'var(--amber)', href: '/fleet/vehicles' },
    { label: 'Inactive',       value: inactive ?? 0, sub: 'Surrendered / idle',  color: 'var(--text3)', href: '/fleet/vehicles' },
    { label: 'Devices',        value: totalDevices  ?? 0, sub: 'MaaS360 managed', href: '/fleet/devices' },
    { label: 'Verizon Lines',  value: totalLines    ?? 0, sub: allOffices ? 'All SIM cards' : 'Filtered', href: '/fleet/lines' },
  ]

  const ACTION_LABELS: Record<string, string> = {
    reboot: 'Reboot', wipe: 'Factory Wipe', kiosk_enter: 'Kiosk Enter',
    kiosk_exit: 'Kiosk Exit', clear_app_data: 'Clear App Data',
    activate_sim: 'Activate SIM', import_ccsi: 'Import CCSI',
    import_devices: 'Import Devices', import_verizon: 'Import Verizon',
    inventory_create: 'Inv. Created', inventory_update: 'Inv. Updated',
    inventory_adjust: 'Inv. Adjusted', inventory_delete: 'Inv. Deleted',
    inventory_card_create: 'Card Created', inventory_card_update: 'Card Updated',
    inventory_card_execute: 'Card Executed', inventory_card_delete: 'Card Deleted',
  }

  function badgeClass(action: string) {
    if (action === 'wipe') return 'badge-red'
    if (action.startsWith('import')) return 'badge-blue'
    if (action.startsWith('inventory')) return 'badge-purple'
    return 'badge-gray'
  }

  function formatDetails(log: Record<string, unknown>): string | null {
    const p = log.payload as Record<string, unknown> | null
    if (!p) return null

    const action = log.action as string

    if (action === 'inventory_card_execute' && Array.isArray(p.changes)) {
      return (p.changes as { name: string; qty_before: number; qty_after: number; subtracted: number }[])
        .map(c => `${c.name}: ${c.qty_before} → ${c.qty_after} (−${c.subtracted})`)
        .join(', ')
    }
    if (action === 'inventory_card_execute' && Array.isArray(p.items_subtracted)) {
      return (p.items_subtracted as { subtracted: number; remaining: number }[])
        .map(c => `−${c.subtracted}, ${c.remaining} left`)
        .join('; ')
    }
    if (action === 'inventory_adjust' && p.previous !== undefined) {
      const label = p.name ? String(p.name) : ''
      return `${label}: ${p.previous} → ${p.new_value} (${Number(p.delta) > 0 ? '+' : ''}${p.delta} ${p.field ?? 'new'})`
    }
    if (action === 'inventory_update' && p.changes && typeof p.changes === 'object') {
      const changes = p.changes as Record<string, { from: unknown; to: unknown }>
      const parts = Object.entries(changes)
        .filter(([k]) => !['updated_at', 'updated_by'].includes(k))
        .map(([k, v]) => {
          const lbl = k.replace(/_/g, ' ').replace('quantity ', 'qty ')
          return `${lbl}: ${v.from ?? '—'} → ${v.to ?? '—'}`
        })
      return parts.length > 0 ? `${p.name ? String(p.name) + ' — ' : ''}${parts.join(', ')}` : null
    }
    if (action === 'inventory_create' && p.name) {
      const parts: string[] = [`"${p.name}"`]
      if (p.quantity_new) parts.push(`new: ${p.quantity_new}`)
      if (p.quantity_used) parts.push(`used: ${p.quantity_used}`)
      return parts.join(', ')
    }
    if (action === 'inventory_delete' && p.name) return `Deleted "${p.name}"`
    if (action.startsWith('inventory_card_') && p.card_name) {
      if (action === 'inventory_card_delete') return `Deleted "${p.card_name}"`
      const items = p.items_count ? ` (${p.items_count} items)` : ''
      return `"${p.card_name}"${items}`
    }
    if (action.startsWith('import') && p.filename) {
      const r = log.result as Record<string, unknown> | null
      const total = r?.total ?? ''
      return `${p.filename}${total ? ` — ${total} rows` : ''}${p.skipped ? `, ${p.skipped} skipped` : ''}`
    }
    if (log.vehicle_number && log.result) {
      const r = log.result as Record<string, unknown>
      return r.message ? String(r.message) : null
    }
    return null
  }

  function getLink(log: Record<string, unknown>): string | null {
    if (log.target_type === 'inventory') return '/inventory'
    if (log.vehicle_number) return `/fleet/vehicles?q=${log.vehicle_number}`
    if (log.target_type === 'device') return '/fleet/devices'
    if ((log.action as string).startsWith('import')) return '/settings?tab=data'
    return null
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

  // ── Fleet Size Trend Data (from Active Vehicle Tracker) ──
  // Monthly snapshots: date, total, ASC, CYC (C Fleet), other (G+O+D fleets)
  const trendPoints = [
    { date: '2024-09-01', total: 1234, asc: 810, cyc: 252, other: 172 },
    { date: '2024-10-01', total: 1276, asc: 829, cyc: 274, other: 173 },
    { date: '2024-11-01', total: 1281, asc: 830, cyc: 278, other: 173 },
    { date: '2024-12-01', total: 1277, asc: 832, cyc: 274, other: 171 },
    { date: '2025-01-01', total: 1290, asc: 840, cyc: 282, other: 168 },
    { date: '2025-02-01', total: 1278, asc: 834, cyc: 272, other: 172 },
    { date: '2025-03-01', total: 1293, asc: 852, cyc: 271, other: 170 },
    { date: '2025-04-01', total: 1313, asc: 865, cyc: 274, other: 174 },
    { date: '2025-05-01', total: 1324, asc: 878, cyc: 272, other: 174 },
    { date: '2025-06-01', total: 1330, asc: 894, cyc: 270, other: 166 },
    { date: '2025-07-01', total: 1435, asc: 900, cyc: 264, other: 271 },
    { date: '2025-08-01', total: 1466, asc: 935, cyc: 258, other: 273 },
    { date: '2025-09-01', total: 1462, asc: 933, cyc: 258, other: 271 },
    { date: '2025-10-01', total: 1498, asc: 956, cyc: 259, other: 283 },
    { date: '2025-11-01', total: 1487, asc: 952, cyc: 261, other: 274 },
    { date: '2025-12-01', total: 1483, asc: 955, cyc: 257, other: 271 },
    { date: '2026-01-01', total: 1463, asc: 938, cyc: 256, other: 269 },
    { date: '2026-02-01', total: 1459, asc: 942, cyc: 260, other: 257 },
    { date: '2026-03-01', total: 1500, asc: 979, cyc: 257, other: 264 },
  ]

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

      {/* Quick Actions — moved here from the dedicated /actions page */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>Quick Actions</div>
        <QuickActions />
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
                <tr><th>Time</th><th>Action</th><th>Details</th><th>Vehicle #</th><th>User</th><th>Result</th></tr>
              </thead>
              <tbody>
                {recentAudit.map((log: Record<string, unknown>) => {
                  const details = formatDetails(log)
                  const link = getLink(log)
                  const action = log.action as string
                  const target = log.target_type === 'inventory' && (log.payload as Record<string, unknown> | null)?.name
                    ? String((log.payload as Record<string, unknown>).name)
                    : log.target_type === 'inventory' && (log.payload as Record<string, unknown> | null)?.card_name
                      ? String((log.payload as Record<string, unknown>).card_name)
                      : String(log.target_id ?? '')

                  return (
                  <tr key={String(log.id)} style={{ cursor: link ? 'pointer' : undefined }}
                    onClick={link ? undefined : undefined}
                    {...(link ? { 'data-href': link } : {})}>
                    <td className="mono text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                      {new Date(String(log.created_at)).toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${badgeClass(action)}`}>
                        {ACTION_LABELS[action] ?? action}
                      </span>
                      {link && <a href={link} style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 4 }}>→</a>}
                    </td>
                    <td style={{ fontSize: 11, maxWidth: 360, color: 'var(--text2)' }}>
                      <div style={{ fontWeight: 500 }}>{target}</div>
                      {details && (
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4, whiteSpace: 'normal' }}>
                          {details}
                        </div>
                      )}
                    </td>
                    <td>{log.vehicle_number ? <span className="tag">#{String(log.vehicle_number)}</span> : <span className="text-dim">—</span>}</td>
                    <td className="text-dim truncate" style={{ maxWidth: 160, fontSize: 11 }}>{String(log.user_email ?? '')}</td>
                    <td><span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>{log.success ? '✓' : '✗'}</span></td>
                  </tr>
                  )
                })}
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
