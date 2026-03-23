import { createClient } from '@/lib/supabase/server'
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
  const { data: profile } = await supabase.from('user_profiles').select('is_admin, offices').eq('id', user!.id).single()
  const userOfficeRestriction: string[] | null = (!profile?.is_admin && Array.isArray(profile?.offices) && profile.offices.length > 0)
    ? profile.offices : null
  const rawOffices = getOfficesFromParam(params.offices)
  const offices    = userOfficeRestriction
    ? (rawOffices === null ? userOfficeRestriction : rawOffices.filter((o: string) => userOfficeRestriction.includes(o)))
    : rawOffices

  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const fleetIds  = getFleetIdsFromFilters(offices, ascFleets)

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

  // ── Fetch vehicles in batches (Supabase 1000-row cap) ───────────────────────
  const allVehicles: { vehicle_number: number; fleet_id: string; driver_phone_norm: string | null; pim_phone_norm: string | null }[] = []
  let from = 0
  while (true) {
    let vq = supabase
      .from('vehicles')
      .select('vehicle_number,fleet_id,driver_phone_norm,pim_phone_norm')
      .range(from, from + 999)
    if (fleetIds !== null && fleetIds.length > 0) vq = vq.in('fleet_id', fleetIds)
    const { data, error } = await vq
    if (error || !data || data.length === 0) break
    allVehicles.push(...data)
    if (data.length < 1000) break
    from += 1000
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

    // Available tab
    if (activeTab === 'available') {
      const norms = Array.from(assignedNorms)
      if (norms.length > 0) query = query.not('phone_norm', 'in', `(${norms.join(',')})`)
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

  const { data: rawLines, count: dbCount } = await query

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
        />
      </Suspense>
    </div>
  )
}
