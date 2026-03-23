import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import DevicesTable from '@/components/DevicesTable'
import { getOfficesFromParam, getAscFleetsFromParam, getFleetIdsFromFilters } from '@/lib/filters'

const DEFAULT_PER_PAGE = 50

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string; per_page?: string
  offices?: string; asc_fleets?: string
  f_type?: string; f_compliance?: string; f_model?: string
  f_os?: string; f_policy?: string
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params    = await searchParams
  const perPage   = Math.min(200, Math.max(10, parseInt(params.per_page ?? String(DEFAULT_PER_PAGE), 10)))
  const page      = Math.max(0, parseInt(params.page ?? '0', 10))
  const search    = params.q?.trim() ?? ''
  const sort      = params.sort ?? 'device_name'
  const dir       = params.dir !== 'desc'

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

  let allowedNameKeys: string[] | null = null
  if (fleetIds !== null) {
    if (fleetIds.length === 0) return (
      <div className="page-content">
        <div className="page-header"><div><h1>Devices</h1><p>0 MaaS360 devices</p></div></div>
        <div className="card"><div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)' }}>No offices selected.</div></div>
      </div>
    )
    const { data: vehs } = await supabase
      .from('vehicles').select('vehicle_name_key').in('fleet_id', fleetIds).not('vehicle_name_key', 'is', null)
    allowedNameKeys = (vehs ?? []).map(v => v.vehicle_name_key)
  }

  let query = supabase
    .from('devices')
    .select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * perPage, (page + 1) * perPage - 1)

  if (allowedNameKeys !== null) {
    if (allowedNameKeys.length === 0) query = query.eq('device_name', '___NO_MATCH___')
    else query = query.in('name_key', allowedNameKeys)
  }

  // Type filter — PIM devices have device_name starting with literal '*'
  if (params.f_type === 'pim') {
    query = query.ilike('device_name', '*%')
  } else if (params.f_type === 'driver') {
    query = query.not('device_name', 'ilike', '*%')
  }

  if (params.f_compliance) query = query.ilike('compliance_status', `%${params.f_compliance}%`)
  if (params.f_model)      query = query.ilike('tablet_model', `%${params.f_model}%`)
  if (params.f_os)         query = query.ilike('android_os', `%${params.f_os}%`)
  if (params.f_policy)     query = query.ilike('m360_policy', `%${params.f_policy}%`)

  if (search) {
    const like = `%${search}%`
    query = query.or(`device_name.ilike.${like},m360_user.ilike.${like},tablet_model.ilike.${like},imei.ilike.${like}`)
  }

  const [{ data, count }, { data: filterData }] = await Promise.all([
    query,
    supabase.from('devices').select('android_os, m360_policy').not('android_os', 'is', null).limit(3000),
  ])
  const osValues     = Array.from(new Set((filterData ?? []).map(d => d.android_os).filter(Boolean))).sort() as string[]
  const policyValues = Array.from(new Set((filterData ?? []).map(d => d.m360_policy).filter(Boolean))).sort() as string[]

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
          page={page} perPage={perPage}
          totalPages={Math.ceil((count ?? 0) / perPage)}
          totalCount={count ?? 0}
          search={search} sort={sort} dir={dir}
          fType={params.f_type ?? ''} fCompliance={params.f_compliance ?? ''}
          fModel={params.f_model ?? ''} fOs={params.f_os ?? ''} fPolicy={params.f_policy ?? ''}
          osValues={osValues} policyValues={policyValues}
        />
      </Suspense>
    </div>
  )
}
