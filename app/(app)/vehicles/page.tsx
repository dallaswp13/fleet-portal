import { createClient } from '@/lib/supabase/server'
import VehiclesTable from '@/components/VehiclesTable'
import type { FleetOverview } from '@/types'
import { getOfficesFromParam, getTabsFromParam, getAscFleetsFromParam, getFleetIdsFromFilters, SHEET_TABS } from '@/lib/filters'

const DEFAULT_PER_PAGE = 50
const SORTABLE = ['vehicle_number','fleet_id','office','online_status','driver_app_version',
  'pim_app_version','meter_status','driver_tablet_phone_number','pim_phone_number',
  'rfid','device_name','verizon_user','monthly_usage_gb']

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string; per_page?: string
  offices?: string; tabs?: string; asc_fleets?: string
  f_status?: string; f_fleet?: string; f_meter?: string; f_tab?: string
  f_driver_app?: string; f_pim_app?: string
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params  = await searchParams
  const perPage = Math.min(200, Math.max(10, parseInt(params.per_page ?? String(DEFAULT_PER_PAGE), 10)))
  const page    = Math.max(0, parseInt(params.page ?? '0', 10))
  const search  = params.q?.trim() ?? ''
  const sort    = SORTABLE.includes(params.sort ?? '') ? params.sort! : 'vehicle_number'
  const dir     = params.dir !== 'desc'

  // Column filters — now server-side
  const fStatus = params.f_status ?? ''
  const fFleet  = params.f_fleet  ?? ''
  const fMeter     = params.f_meter      ?? ''
  const fTab       = params.f_tab        ?? ''
  const fDriverApp = params.f_driver_app ?? ''
  const fPimApp    = params.f_pim_app    ?? ''

  const offices   = getOfficesFromParam(params.offices)
  const tabs      = getTabsFromParam(params.tabs)
  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const allTabs   = tabs.length === SHEET_TABS.length

  const fleetIds = getFleetIdsFromFilters(offices, ascFleets)
  const supabase = await createClient()

  let query = supabase
    .from('fleet_overview')
    .select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * perPage, (page + 1) * perPage - 1)

  if (fleetIds !== null) {
    if (fleetIds.length === 0) query = query.eq('vehicle_number', -1)
    else query = query.in('fleet_id', fleetIds)
  }

  if (!allTabs) query = query.in('sheet_tab', tabs)

  // Server-side column filters
  if (fStatus) query = query.ilike('online_status', `${fStatus}%`)
  if (fFleet)  query = query.eq('fleet_id', fFleet)
  if (fMeter)     query = query.ilike('meter_status', `${fMeter}%`)
  if (fTab)       query = query.eq('sheet_tab', fTab)
  if (fDriverApp) query = query.eq('driver_app_version', fDriverApp)
  if (fPimApp)    query = query.eq('pim_app_version', fPimApp)

  if (search) {
    const like = `%${search}%`
    // When search is digits only, also generate a fuzzy phone pattern
    // so "2132594422" matches stored "213-259-4422" or "(213) 259-4422"
    const digits = search.replace(/\D/g, '')
    const phoneLike = digits.length >= 7
      ? `%${digits.slice(0,3)}%${digits.slice(3,6)}%${digits.slice(6)}%`
      : like

    if (/^\d+$/.test(search)) {
      query = query.or(
        `vehicle_number.eq.${parseInt(search, 10)},` +
        `driver_tablet_phone_number.ilike.${phoneLike},pim_phone_number.ilike.${phoneLike},` +
        `rfid.ilike.${like},device_name.ilike.${like},verizon_user.ilike.${like}`
      )
    } else {
      // Non-digit search — strip dashes in case user typed with them
      const stripped = search.replace(/[-().\s]/g, '')
      const strippedLike = stripped.length >= 7
        ? `%${stripped.slice(0,3)}%${stripped.slice(3,6)}%${stripped.slice(6)}%`
        : like
      query = query.or(
        `driver_tablet_phone_number.ilike.${like},driver_tablet_phone_number.ilike.${strippedLike},` +
        `pim_phone_number.ilike.${like},pim_phone_number.ilike.${strippedLike},` +
        `rfid.ilike.${like},meter_bluetooth_name.ilike.${like},device_name.ilike.${like},` +
        `verizon_user.ilike.${like},fleet_id.ilike.${like},office.ilike.${like}`
      )
    }
  }

  const [{ data, error, count }, { data: appVerData }] = await Promise.all([
    query,
    supabase.from('fleet_overview').select('driver_app_version, pim_app_version').not('driver_app_version', 'is', null).limit(3000),
  ])
  const driverAppVersions = Array.from(new Set((appVerData ?? []).map(r => r.driver_app_version).filter(Boolean))).sort() as string[]
  const pimAppVersions    = Array.from(new Set((appVerData ?? []).map(r => r.pim_app_version).filter(Boolean))).sort() as string[]

  if (error) return (
    <div className="page-content">
      <div className="alert alert-error">Failed to load vehicles: {error.message}</div>
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Vehicles</h1>
          <p>{(count ?? 0).toLocaleString()} fleet records — click any row to manage</p>
        </div>
      </div>
      <VehiclesTable
        vehicles={(data ?? []) as FleetOverview[]}
        page={page} perPage={perPage}
        totalPages={Math.ceil((count ?? 0) / perPage)}
        totalCount={count ?? 0}
        search={search} sort={sort} dir={dir}
        fStatus={fStatus} fFleet={fFleet} fMeter={fMeter} fTab={fTab}
        fDriverApp={fDriverApp} fPimApp={fPimApp}
        driverAppVersions={driverAppVersions} pimAppVersions={pimAppVersions}
      />
    </div>
  )
}
