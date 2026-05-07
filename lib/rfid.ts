/**
 * RFID suggester for the dashboard "Get RFID" quick action.
 *
 * Conventions per fleet (per spec):
 *   E — prepend 8 to a 3-digit vehicle number   (820 → 8820)
 *   Y — replace leading 6 with 1                (6020 → 1020)
 *   U — replace leading 1 with 6                (1502 → 6502)
 *   L, S — no fixed convention; gap-find within the existing fleet's range
 *
 * If the conventional RFID for E/Y/U is already in use, OR the conventional
 * rule doesn't apply (e.g. an E-fleet vehicle isn't 3 digits, or a Y-fleet
 * vehicle doesn't start with 6), we fall back to the same gap-find used for
 * L/S. Gap-find returns the smallest unused integer between the fleet's
 * existing min and max RFID — biases toward something that "fits" with
 * neighbors and avoids 0001 / 9999 style values.
 */

export type RfidFleet = 'E' | 'L' | 'S' | 'Y' | 'U'

export interface RfidSuggestionInput {
  vehicleNumber: number
  fleet: RfidFleet
  /** RFIDs already in use across the entire fleet (any fleet_id). */
  allUsedRfids: string[]
  /** RFIDs already in use, restricted to the same fleet — used for gap-find. */
  fleetUsedRfids: string[]
}

export interface RfidSuggestionResult {
  suggested: string
  /**
   * Why this value was chosen. Useful in the UI so the user can see whether
   * the convention applied or we fell back.
   */
  reason: 'convention' | 'gap_in_fleet' | 'next_after_max'
  /** Human-readable explanation for the modal. */
  explanation: string
  /** True when the convention couldn't apply or its RFID was taken. */
  fellBack: boolean
}

export class RfidSuggestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RfidSuggestionError'
  }
}

/**
 * Compute the conventional RFID for a fleet+vehicle, or null if the
 * convention doesn't apply (e.g. E fleet but vehicle isn't 3 digits).
 */
export function conventionalRfid(fleet: RfidFleet, vehicleNumber: number): string | null {
  const v = String(vehicleNumber)
  if (fleet === 'E') {
    return v.length === 3 ? '8' + v : null
  }
  if (fleet === 'Y') {
    return v.startsWith('6') ? '1' + v.slice(1) : null
  }
  if (fleet === 'U') {
    return v.startsWith('1') ? '6' + v.slice(1) : null
  }
  // L and S have no convention
  return null
}

/**
 * Coerce an RFID string to a positive integer, or null if it isn't purely
 * numeric. Leading zeros are stripped (so "0820" and "820" collide as 820).
 */
function toInt(rfid: string | null | undefined): number | null {
  if (rfid == null) return null
  const trimmed = String(rfid).trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = parseInt(trimmed, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Build a Set of every numerically-used RFID across the input list.
 */
function usedIntSet(rfids: string[]): Set<number> {
  const s = new Set<number>()
  for (const r of rfids) {
    const n = toInt(r)
    if (n !== null) s.add(n)
  }
  return s
}

/**
 * Find the smallest unused integer between min and max of the fleet's
 * existing RFID range. If no gap exists, returns max + 1.
 */
export function gapFind(fleetUsedRfids: string[], allUsedRfids: string[]): {
  suggested: string
  reason: 'gap_in_fleet' | 'next_after_max'
} {
  const fleetInts = Array.from(usedIntSet(fleetUsedRfids)).sort((a, b) => a - b)
  const allUsed = usedIntSet(allUsedRfids)

  if (fleetInts.length === 0) {
    // No existing RFIDs in this fleet to anchor on. Best we can do is start
    // at 1000 (4-digit, sensible default) and walk up. The caller can
    // override by switching to a fleet-specific seed.
    let candidate = 1000
    while (allUsed.has(candidate)) candidate++
    return { suggested: String(candidate), reason: 'next_after_max' }
  }

  const min = fleetInts[0]
  const max = fleetInts[fleetInts.length - 1]

  // Smallest gap inside [min, max] that isn't used by ANY vehicle (cross-fleet
  // collisions matter — the user said RFIDs must be unique site-wide).
  for (let i = min + 1; i < max; i++) {
    if (!allUsed.has(i)) return { suggested: String(i), reason: 'gap_in_fleet' }
  }

  // No gap inside the range — pick max + 1, walking past any cross-fleet collisions.
  let candidate = max + 1
  while (allUsed.has(candidate)) candidate++
  return { suggested: String(candidate), reason: 'next_after_max' }
}

export function suggestRfid(input: RfidSuggestionInput): RfidSuggestionResult {
  const { vehicleNumber, fleet, allUsedRfids, fleetUsedRfids } = input

  if (!Number.isInteger(vehicleNumber) || vehicleNumber <= 0) {
    throw new RfidSuggestionError('Vehicle number must be a positive integer')
  }

  const allUsedSet = usedIntSet(allUsedRfids)

  // 1) Try the convention for E/Y/U
  const conv = conventionalRfid(fleet, vehicleNumber)
  if (conv) {
    const convInt = toInt(conv)
    const taken = convInt !== null && allUsedSet.has(convInt)
    if (!taken) {
      return {
        suggested: conv,
        reason: 'convention',
        fellBack: false,
        explanation:
          fleet === 'E' ? `E-fleet convention: prepend "8" to vehicle number ${vehicleNumber}.`
            : fleet === 'Y' ? `Y-fleet convention: replace leading 6 in ${vehicleNumber} with 1.`
            : `U-fleet convention: replace leading 1 in ${vehicleNumber} with 6.`,
      }
    }
    // Convention RFID is taken — fall through to gap-find
    const gf = gapFind(fleetUsedRfids, allUsedRfids)
    return {
      suggested: gf.suggested,
      reason: gf.reason,
      fellBack: true,
      explanation:
        `Convention says ${conv}, but that's already in use. Falling back to the smallest ` +
        `unused number in fleet ${fleet}'s existing range.`,
    }
  }

  // 2) L, S, or convention didn't apply → gap-find
  const gf = gapFind(fleetUsedRfids, allUsedRfids)
  const noConventionForFleet = fleet === 'L' || fleet === 'S'
  return {
    suggested: gf.suggested,
    reason: gf.reason,
    fellBack: !noConventionForFleet,
    explanation: noConventionForFleet
      ? `Fleet ${fleet} has no fixed RFID convention. Picked the smallest unused number ` +
        `in the fleet's existing range so it sits with its neighbors.`
      : `Fleet ${fleet} convention only applies to vehicles whose number matches the ` +
        `expected pattern; vehicle ${vehicleNumber} doesn't, so falling back to gap-find.`,
  }
}
