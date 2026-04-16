import { redirect } from 'next/navigation'

/**
 * Legacy route — Drivers is now part of the consolidated /fleet section.
 */
export default async function DriversRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }
  const suffix = qs.toString()
  redirect('/fleet/drivers' + (suffix ? `?${suffix}` : ''))
}
