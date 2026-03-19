import { createClient } from '@/lib/supabase/server'
import VehiclesTable from '@/components/VehiclesTable'
import type { FleetOverview } from '@/types'
import { getOfficesFromParam, getTabsFromParam, getAscFleetsFromParam, getFleetIdsFromFilters, SHEET_TABS } from '@/lib/filters'

const PER_PAGE = 50

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string
  offices?: string; tabs?: string; asc_fleets?: string
}

const SORTABLE = ['vehicle_number','fleet_id','office','online_status','driver_app_version',
  'pim_app_version','meter_status','driver_tablet_phone_number','pim_phone_number',
  'rfid','device_name','verizon_user','monthly_usage_gb']

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params  = await searchParams
  const page    = Math.max(0, parseInt(params.page ?? '0', 10))
  const search  = params.q?.trim() ?? ''
  const sort    = SORTABLE.includes(params.sort ?? '') ? params.sort! : 'vehicle_number'
  const dir     = params.dir !== 'desc'

  const offices   = getOfficesFromParam(params.offices)
  const tabs      = getTabsFromParam(params.tabs)
  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const allTabs   = tabs.length === SHEET_TABS.length

  // Resolve fleet_ids from office + ASC sub-fleet selection
  const fleetIds = getFleetIdsFromFilters(offices, ascFleets)

  const supabase = await createClient()

  let query = supabase
    .from('fleet_overview')
    .select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

  // Filter by fleet_id (handles both office and ASC sub-fleet in one shot)
  if (fleetIds !== null) {
    if (fleetIds.length === 0) {
      // Nothing selected — return empty
      query = query.eq('vehicle_number', -1)
    } else {
      query = query.in('fleet_id', fleetIds)
    }
  }

  if (!allTabs) query = query.in('sheet_tab', tabs)

  if (search) {
    const like = `%${search}%`
    if (/^\d+$/.test(search)) {
      query = query.or(
        `vehicle_number.eq.${parseInt(search, 10)},` +
        `driver_tablet_phone_number.ilike.${like},pim_phone_number.ilike.${like},driver_phone_norm.ilike.${like},pim_phone_norm.ilike.${like},` +
        `rfid.ilike.${like},device_name.ilike.${like},verizon_user.ilike.${like}`
      )
    } else {
      query = query.or(
        `driver_tablet_phone_number.ilike.${like},pim_phone_number.ilike.${like},driver_phone_norm.ilike.${like},pim_phone_norm.ilike.${like},` +
        `rfid.ilike.${like},meter_bluetooth_name.ilike.${like},device_name.ilike.${like},` +
        `verizon_user.ilike.${like},fleet_id.ilike.${like},office.ilike.${like}`
      )
    }
  }

  const { data, error, count } = await query

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
        page={page}
        totalPages={Math.ceil((count ?? 0) / PER_PAGE)}
        totalCount={count ?? 0}
        search={search}
        sort={sort}
        dir={dir}
      />
    </div>
  )
}
