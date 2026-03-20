/**
 * Server-side filter helpers — safe to import in Server Components.
 * These read raw searchParam strings and return typed arrays.
 * Keep this file free of any browser/client imports.
 */

export const OFFICES    = ['ASC', 'CYC', 'SDY', 'DEN'] as const
export const SHEET_TABS = ['Active Vehicles', 'Test Vehicles', 'Surrenders'] as const
export const DEFAULT_TABS: SheetTab[] = ['Active Vehicles', 'Test Vehicles']

export type Office   = typeof OFFICES[number]
export type SheetTab = typeof SHEET_TABS[number]

export const OFFICE_COLORS: Record<Office, string> = {
  ASC: '#3b82f6',   // blue
  CYC: '#f97316',   // orange  (distinct from amber Test filter)
  SDY: '#06b6d4',   // cyan    (distinct from green Active filter)
  DEN: '#9b59b6',   // purple
}

// Map fleet_id letter to its office color
export function fleetColor(fleetId: string | null | undefined): string {
  const f = (fleetId ?? '').toUpperCase()
  if (f === 'C') return OFFICE_COLORS.CYC
  if (f === 'G') return OFFICE_COLORS.SDY
  if (f === 'D') return OFFICE_COLORS.DEN
  if (['E','L','S','Y','U'].includes(f)) return OFFICE_COLORS.ASC
  return '#6b7280'
}

export function officeColor(office: string | null | undefined): string {
  const o = (office ?? '').toUpperCase()
  if (o === 'CYC') return OFFICE_COLORS.CYC
  if (o === 'SDY') return OFFICE_COLORS.SDY
  if (o === 'DEN') return OFFICE_COLORS.DEN
  if (o === 'ASC') return OFFICE_COLORS.ASC
  return '#6b7280'
}

export const SUB_ACCOUNT_OFFICE: Record<string, string> = {
  '571689935-00002': 'ASC',
  '571689935-00003': 'CYC',
  '571689935-00004': 'SDY',
  '571689935-00010': 'DEN',
  '571689935-00007': 'Staff',
  '571689935-00009': 'Staff',
}

/** Parse office filter from URL searchParams string. Returns all offices if unset. */
export function getOfficesFromParam(raw: string | undefined | null): Office[] {
  if (!raw) return [...OFFICES]
  const vals = raw.split(',').filter((o): o is Office => OFFICES.includes(o as Office))
  return vals.length ? vals : [...OFFICES]
}

/** Parse tab filter from URL searchParams string. Returns all tabs if unset. */
export function getTabsFromParam(raw: string | undefined | null): SheetTab[] {
  if (!raw) return [...DEFAULT_TABS]
  const vals = raw.split(',').filter((t): t is SheetTab => SHEET_TABS.includes(t as SheetTab))
  return vals.length ? vals : [...SHEET_TABS]
}

// ASC sub-fleets
export const ASC_FLEETS = ['E', 'L', 'S', 'Y', 'U'] as const
export type AscFleet = typeof ASC_FLEETS[number]

/** Map driver/vehicle fleet_id to office */
export function fleetToOffice(fleetId: string): string | null {
  const f = fleetId.toUpperCase()
  if (f === 'C') return 'CYC'
  if (f === 'G') return 'SDY'
  if (f === 'D') return 'DEN'
  if (['E','L','S','Y','U'].includes(f)) return 'ASC'
  return null
}

/** Parse ASC fleet sub-filter from URL params */
export function getAscFleetsFromParam(raw: string | undefined | null): string[] {
  if (!raw) return [...ASC_FLEETS]
  const vals = raw.split(',').filter(f => ASC_FLEETS.includes(f as AscFleet))
  return vals.length ? vals : [...ASC_FLEETS]
}

/**
 * Given selected offices and ASC sub-fleets, returns the fleet_id list
 * that should be used to filter vehicles/devices/lines.
 * Returns null if all offices + all ASC fleets are selected (no filter needed).
 */
export function getFleetIdsFromFilters(
  offices: string[],
  ascFleets: string[]
): string[] | null {
  const allOffices   = offices.length === OFFICES.length
  const allAscFleets = ascFleets.length === ASC_FLEETS.length

  if (allOffices && allAscFleets) return null // no filter

  const fleetIds: string[] = []
  if (offices.includes('CYC')) fleetIds.push('C')
  if (offices.includes('SDY')) fleetIds.push('G')
  if (offices.includes('DEN')) fleetIds.push('D')
  if (offices.includes('ASC')) {
    // Only add the selected ASC sub-fleets
    for (const f of ascFleets) {
      if (ASC_FLEETS.includes(f as AscFleet)) fleetIds.push(f)
    }
  }
  return fleetIds
}
