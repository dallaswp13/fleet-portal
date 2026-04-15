import { redirect } from 'next/navigation'

/**
 * Legacy route — the Vehicles page is now part of the consolidated /fleet
 * section. Preserve old bookmarks and hardcoded links by forwarding them,
 * including any query-string filters (offices, tabs, asc_fleets, search, etc.).
 */
export default async function VehiclesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }
  const suffix = qs.toString()
  redirect('/fleet/vehicles' + (suffix ? `?${suffix}` : ''))
}
