import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import DriversGrid from '@/components/DriversGrid'
import { getOfficesFromParam, getAscFleetsFromParam, getFleetIdsFromFilters } from '@/lib/filters'

const PER_PAGE = 60

interface SearchParams {
  page?: string; q?: string; tab?: string
  offices?: string; asc_fleets?: string
  has_phone?: string
}

export default async function DriversPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params   = await searchParams
  const page     = Math.max(0, parseInt(params.page ?? '0', 10))
  const search   = params.q?.trim() ?? ''
  const tab      = (params.tab ?? 'active') as 'active' | 'inactive' | 'all'
  const hasPhone = params.has_phone === '1'

  const supabase = await createClient()

  // Auth + office restriction
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('user_profiles').select('is_admin, offices').eq('id', user.id).single()
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  const isAdminByEmail = adminEmail && user.email === adminEmail
  const userOfficeRestriction: string[] | null =
    (profile?.is_admin === true || isAdminByEmail) ? null : !profile ? [] : profile.offices ?? []

  const rawOffices = getOfficesFromParam(params.offices)
  const offices    = userOfficeRestriction
    ? (rawOffices === null ? userOfficeRestriction : rawOffices.filter((o: string) => userOfficeRestriction.includes(o)))
    : rawOffices
  const ascFleets = getAscFleetsFromParam(params.asc_fleets)
  const fleetIds  = getFleetIdsFromFilters(offices, ascFleets)

  // Build base query helper
  function buildQuery(activeFilter?: boolean) {
    let q = supabase.from('drivers').select('*', { count: 'exact' })
    if (activeFilter !== undefined) q = q.eq('active', activeFilter)
    if (fleetIds !== null && fleetIds.length > 0) q = q.in('fleet_id', fleetIds)
    else if (fleetIds !== null && fleetIds.length === 0) q = q.eq('fleet_id', '___NONE___')
    if (hasPhone) q = q.not('personal_phone_norm', 'is', null).neq('personal_phone_norm', '')
    if (search) {
      const like = `%${search}%`
      q = q.or(`name.ilike.${like},email.ilike.${like},driver_id::text.ilike.${like},personal_phone.ilike.${like},drivers_license.ilike.${like}`)
    }
    return q
  }

  // Get counts for tabs — respect fleet/office filters and run in parallel with main query
  function countQuery(activeFilter?: boolean) {
    let q = supabase.from('drivers').select('*', { count: 'exact', head: true })
    if (activeFilter !== undefined) q = q.eq('active', activeFilter)
    if (fleetIds !== null && fleetIds.length > 0) q = q.in('fleet_id', fleetIds)
    else if (fleetIds !== null && fleetIds.length === 0) q = q.eq('fleet_id', '___NONE___')
    return q
  }

  // Build main paginated query
  let query = buildQuery(tab === 'active' ? true : tab === 'inactive' ? false : undefined)
  query = query.order('name').range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

  // Run all queries in parallel
  const [{ count: activeCount }, { count: inactiveCount }, { count: allCount }, { data: drivers, count: filteredCount }] = await Promise.all([
    countQuery(true),
    countQuery(false),
    countQuery(),
    query,
  ])

  const totalPages = Math.ceil((filteredCount ?? 0) / PER_PAGE)

  return (
    <div className="page-content">
      <Suspense fallback={<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>{Array.from({ length: 12 }).map((_, i) => (<div key={i} className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}><span className="skeleton skeleton-avatar" style={{ width: 48, height: 48 }} /><div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><span className="skeleton skeleton-text" style={{ width: '70%' }} /><span className="skeleton skeleton-text-sm" style={{ width: '50%' }} /></div></div>))}</div>}>
        <DriversGrid
          drivers={(drivers ?? []) as Record<string, unknown>[]}
          page={page}
          totalPages={totalPages}
          totalCount={filteredCount ?? 0}
          search={search}
          activeTab={tab}
          activeCount={activeCount ?? 0}
          inactiveCount={inactiveCount ?? 0}
          allCount={allCount ?? 0}
          hasPhone={hasPhone}
        />
      </Suspense>
    </div>
  )
}
