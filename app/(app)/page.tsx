import { createClient } from '@/lib/supabase/server'
import DashboardCharts from '@/components/DashboardCharts'
import DashboardStats from '@/components/DashboardStats'
import { getOfficesFromParam, getTabsFromParam, getAscFleetsFromParam, getFleetIdsFromFilters, OFFICES, SHEET_TABS } from '@/lib/filters'

interface SearchParams { offices?: string; tabs?: string; asc_fleets?: string }

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
  ] = await Promise.all([
    vehicleQuery(),
    vehicleQuery().ilike('online_status', 'Online%'),
    vehicleQuery().ilike('online_status', 'Offline%'),
    vehicleQuery().not('online_status', 'ilike', 'Online%').not('online_status', 'ilike', 'Offline%'),
    // Devices: count distinct devices linked to vehicles in the selected offices
    // fleet_overview has device_id + office, count non-null device_ids
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
