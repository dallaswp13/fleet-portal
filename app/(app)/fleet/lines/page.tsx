import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import LinesTable from '@/components/LinesTable'
import { getOfficesFromParam, getAscFleetsFromParam, getFleetIdsFromFilters } from '@/lib/filters'

const DEFAULT_PER_PAGE = 50
const STAFF_ACCTS = ['571689935-00007', '571689935-00009']

function normalizePhone(s: string | null | undefined): string {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string; per_page?: string
  offices?: string; asc_fleets?: string; tab?: string
  f_role?: string; f_status?: string; f_vehicle?: string
}

export default async function LinesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params    = await searchParams
  const perPage   = Math.min(500, Math.max(10, parseInt(params.per_page ?? String(DEFAULT_PER_PAGE), 10)))
  const page      = Math.max(0, parseInt(params.page ?? '0', 10))
  const search    = params.q?.trim() ?? ''
  const sort      = params.sort ?? 'phone_number'
  const dir       = params.dir !== 'desc'
  const activeTab = (params.tab ?? 'all') as 'all' | 'available' | 'staff'
  const fRole     = params.f_role ?? ''
  const fStatus   = params.f_status ?? ''
  const fVehicle  = params.f_vehicle ?? ''

  const supabase  = await createClient()

  // Enforce per-user office restriction
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('user_profiles').select('is_admin, offices').eq('id', user.id).single()
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  const isAdminByEmail = adminEmail && user.email === adminEmail
  const userOfficeRestriction: string[] | null =
    (profile?.is_admin === true || isAdminByEmail)
      ? null               // admins: unrestricted
      : !profile
        ? []               // no profile row: safety fallback — show nothing
        : profile.offices ?? []  // null = no offices assigned = show nothing
  const rawOffices = getOfficesFromParam(params.offices)
  const offices    = userOfficeRestriction
    ? (rawOffices === null ? userOfficeRestriction : rawOffices.filter((o: string) => userOfficeRestriction.includes(o)))
    : rawOffices

  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const fleetIds  = getFleetIdsFromFilters(offices, ascFleets)

  // If user has no permitted offices, short-circuit before fetching any data
  if (fleetIds !== null && fleetIds.length === 0) return (
    <div className="page-content">
      <div className="page-header"><div><h1>Verizon Lines</h1><p>0 lines</p></div></div>
      <div className="card"><div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)' }}>No offices selected.</div></div>
    </div>
  )

  // Build office list
  const officeList: string[] = []
  if (fleetIds === null) {
    officeList.push('ASC', 'CYC', 'SDY', 'DEN')
  } else {
    const s = new Set(fleetIds)
    if (s.has('C')) officeList.push('CYC')
    if (s.has('G')) officeList.push('SDY')
    if (s.has('D')) officeList.push('DEN')
    if (['E','L','S','Y','U'].some(f => s.has(f))) officeList.push('ASC')
  }

  // ── Fetch vehicles in parallel batches (Supabase 1000-row cap) ──────────────
  // Fire up to 5 parallel range queries to avoid the serial waterfall that
  // added multi-second latency on fleets with thousands of vehicles.
  const MAX_PARALLEL_BATCHES = 5
  const BATCH = 1000
  type VehicleRow = { vehicle_number: number; fleet_id: string; driver_phone_norm: string | null; pim_phone_norm: string | null }

  function vehicleBatchQuery(rangeStart: number) {
    let vq = supabase
      .from('vehicles')
      .select('vehicle_number,fleet_id,driver_phone_norm,pim_phone_norm')
      .range(rangeStart, rangeStart + BATCH - 1)
    if (fleetIds !== null && fleetIds.length > 0) vq = vq.in('fleet_id', fleetIds)
    return vq
  }

  // First batch to get an idea of total size
  const first = await vehicleBatchQuery(0)
  let allVehicles: VehicleRow[] = first.data ?? []

  if (allVehicles.length === BATCH) {
    // Likely more rows — fire parallel batches for the rest
    const offsets = Array.from({ length: MAX_PARALLEL_BATCHES }, (_, i) => (i + 1) * BATCH)
    const results = await Promise.all(offsets.map(o => vehicleBatchQuery(o)))
    for (const r of results) {
      if (r.data && r.data.length > 0) allVehicles.push(...r.data)
    }
  }

  // Build phone maps
  const driverMap = new Map<string, { vehicleNum: number; fleetId: string }>()
  const pimMap    = new Map<string, { vehicleNum: number; fleetId: string }>()
  for (const v of allVehicles) {
    const nd = normalizePhone(v.driver_phone_norm)
    const np = normalizePhone(v.pim_phone_norm)
    if (nd) driverMap.set(nd, { vehicleNum: v.vehicle_number, fleetId: v.fleet_id })
    if (np) pimMap.set(np,    { vehicleNum: v.vehicle_number, fleetId: v.fleet_id })
  }

  const assignedNorms = new Set(Array.from(driverMap.keys()).concat(Array.from(pimMap.keys())))
  const driverNorms   = new Set(Array.from(driverMap.keys()))
  const pimNorms      = new Set(Array.from(pimMap.keys()))

  // ── Build DB query — push role/vehicle filters into DB ───────────────────
  let query = supabase
    .from('verizon_lines')
    .select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * perPage, (page + 1) * perPage - 1)

  if (activeTab === 'staff') {
    query = query.in('account_number', STAFF_ACCTS)
  } else {
    query = query.not('account_number', 'in', `(${STAFF_ACCTS.join(',')})`)

    // Office filter
    if (officeList.length > 0 && officeList.length < 4) {
      query = query.or(`office.in.(${officeList.join(',')}),office.is.null`)
    }

    // Role filter — translate to phone_norm set filter
    if (fRole === 'Driver') {
      const norms = Array.from(driverNorms)
      if (norms.length === 0) query = query.eq('phone_norm', '___NO_MATCH___')
      else query = query.in('phone_norm', norms)
    } else if (fRole === 'PIM') {
      const norms = Array.from(pimNorms)
      if (norms.length === 0) query = query.eq('phone_norm', '___NO_MATCH___')
      else query = query.in('phone_norm', norms)
    } else if (fRole === 'Unassigned') {
      const norms = Array.from(assignedNorms)
      if (norms.length > 0) query = query.not('phone_norm', 'in', `(${norms.join(',')})`)
    }

    // Vehicle assigned/unassigned filter
    if (fVehicle === 'assigned') {
      const norms = Array.from(assignedNorms)
      if (norms.length > 0) query = query.in('phone_norm', norms)
    } else if (fVehicle === 'unassigned') {
      const norms = Array.from(assignedNorms)
      if (norms.length > 0) query = query.not('phone_norm', 'in', `(${norms.join(',')})`)
    }

    // Available tab — use RPC if available, else fall back to NOT IN filter
    if (activeTab === 'available') {
      // Try RPC approach first (avoids URL length limits with many norms)
      let rpcNorms: string[] | null = null
      try {
        const { data: rpcData } = await supabase.rpc('get_available_line_norms', {
          p_offices: officeList.length > 0 && officeList.length < 4 ? officeList : null,
          p_limit: perPage,
          p_offset: page * perPage,
        })
        if (rpcData && Array.isArray(rpcData)) {
          rpcNorms = rpcData.map((r: { norm: string }) => r.norm).filter(Boolean)
        }
      } catch { /* RPC not available yet — migration 025 not run */ }

      if (rpcNorms !== null) {
        // RPC worked: filter to just this page of available norms
        if (rpcNorms.length > 0) {
          query = query.in('phone_norm', rpcNorms)
        } else {
          query = query.eq('phone_norm', '___NO_AVAILABLE_LINES___')
        }
      } else {
        // Fallback: old NOT IN approach
        const norms = Array.from(assignedNorms)
        if (norms.length > 0) query = query.not('phone_norm', 'in', `(${norms.join(',')})`)
      }
    }

    if (fStatus) query = query.ilike('phone_status', `%${fStatus}%`)
    if (search) {
      const like = `%${search}%`
      // Also match digits-only phone search
      const digits = search.replace(/\D/g, '')
      if (digits && digits !== search) {
        query = query.or(`phone_number.ilike.${like},phone_number.ilike.%${digits}%,verizon_user.ilike.${like},mobile_plan.ilike.${like}`)
      } else {
        query = query.or(`phone_number.ilike.${like},verizon_user.ilike.${like},mobile_plan.ilike.${like}`)
      }
    }
  }

  // Run main query and available-line count in parallel
  async function getAvailableCount(): Promise<number> {
    try {
      const { data: countData } = await supabase.rpc('count_available_lines', {
        p_offices: officeList.length > 0 && officeList.length < 4 ? officeList : null,
      })
      return typeof countData === 'number' ? countData : 0
    } catch { return 0 }
  }

  const [{ data: rawLines, count: dbCount }, availableCount] = await Promise.all([
    query,
    getAvailableCount(),
  ])

  // Join vehicle data for display
  const lines = (rawLines ?? []).map(l => {
    const norm = normalizePhone(String(l.phone_norm ?? l.phone_number ?? ''))
    const dv   = driverMap.get(norm)
    const pv   = pimMap.get(norm)
    const veh  = dv ?? pv
    return { ...l, vehicle_number: veh?.vehicleNum ?? null, fleet_id: veh?.fleetId ?? null, role: dv ? 'Driver' : pv ? 'PIM' : null }
  })

  const totalGB = lines.reduce((s, l) => s + (Number(l.monthly_usage_gb) || 0), 0)

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Verizon</h1>
          <p>{(dbCount ?? 0).toLocaleString()} lines · {totalGB.toFixed(1)} GB this cycle</p>
        </div>
      </div>
      <Suspense fallback={null}>
        <LinesTable
          lines={lines as Record<string,unknown>[]}
          page={page} perPage={perPage}
          totalPages={Math.ceil((dbCount ?? 0) / perPage)}
          totalCount={dbCount ?? 0}
          search={search} sort={sort} dir={dir} activeTab={activeTab}
          fRole={fRole} fStatus={fStatus} fVehicle={fVehicle}
          availableCount={availableCount}
          assignedCount={assignedNorms.size}
        />
      </Suspense>
    </div>
  )
}
