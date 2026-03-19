import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import DevicesTable from '@/components/DevicesTable'
import { getOfficesFromParam, getAscFleetsFromParam, getFleetIdsFromFilters } from '@/lib/filters'

const PER_PAGE = 100

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string
  offices?: string; asc_fleets?: string; tabs?: string
  f_type?: string; f_compliance?: string; f_model?: string
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params    = await searchParams
  const page      = Math.max(0, parseInt(params.page ?? '0', 10))
  const search    = params.q?.trim() ?? ''
  const sort      = params.sort ?? 'device_name'
  const dir       = params.dir !== 'desc'

  const offices   = getOfficesFromParam(params.offices)
  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const fleetIds  = getFleetIdsFromFilters(offices, ascFleets)

  const supabase  = await createClient()

  // Devices don't have fleet_id — join through vehicles via name_key
  // We filter by fetching device name_keys for matching vehicles first
  let allowedNameKeys: string[] | null = null
  if (fleetIds !== null) {
    if (fleetIds.length === 0) {
      // Nothing selected — return empty
      return (
        <div className="page-content">
          <div className="page-header"><div><h1>Devices</h1><p>0 MaaS360 devices</p></div></div>
          <div className="card"><div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)' }}>No offices selected.</div></div>
        </div>
      )
    }
    const { data: vehs } = await supabase
      .from('vehicles').select('vehicle_name_key').in('fleet_id', fleetIds).not('vehicle_name_key', 'is', null)
    allowedNameKeys = (vehs ?? []).map(v => v.vehicle_name_key)
  }

  let query = supabase
    .from('devices')
    .select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

  if (allowedNameKeys !== null) {
    if (allowedNameKeys.length === 0) {
      query = query.eq('device_name', '___NO_MATCH___')
    } else {
      query = query.in('name_key', allowedNameKeys)
    }
  }

  // Column filters — use explicit filter syntax for type
  if (params.f_type === 'pim') {
    // PIM devices have device_name starting with *
    query = query.ilike('device_name', '*%')
  } else if (params.f_type === 'driver') {
    // Driver devices do NOT start with * and are not null
    // Use or() to handle both conditions explicitly
    query = query.not('device_name', 'is', null)
               .not('device_name', 'ilike', '*%')
  }
  if (params.f_compliance)        query = query.ilike('compliance_status', `%${params.f_compliance}%`)
  if (params.f_model)             query = query.ilike('tablet_model', `%${params.f_model}%`)

  if (search) {
    const like = `%${search}%`
    query = query.or(`device_name.ilike.${like},m360_user.ilike.${like},tablet_model.ilike.${like},imei.ilike.${like}`)
  }

  const { data, count } = await query

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p>{(count ?? 0).toLocaleString()} MaaS360 devices</p>
        </div>
      </div>
      <Suspense fallback={null}>
        <DevicesTable
          devices={(data ?? []) as Record<string, unknown>[]}
          page={page}
          totalPages={Math.ceil((count ?? 0) / PER_PAGE)}
          totalCount={count ?? 0}
          search={search} sort={sort} dir={dir}
          fType={params.f_type ?? ''} fCompliance={params.f_compliance ?? ''} fModel={params.f_model ?? ''}
        />
      </Suspense>
    </div>
  )
}
