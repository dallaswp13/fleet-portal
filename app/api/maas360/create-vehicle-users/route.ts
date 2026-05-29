import { NextResponse } from 'next/server'

/**
 * REMOVED. MaaS360 user provisioning was unverified against the live API and
 * the Fleet Portal is not a source of truth for new records, so the
 * "Create Vehicle" workflow and its provisioning call were removed.
 *
 * This stub remains only because the route file cannot be deleted in this
 * environment; it accepts no work and returns 410 Gone. Safe to delete the
 * containing folder in a normal checkout.
 */
export async function POST() {
  return NextResponse.json(
    { success: false, error: 'M360 user provisioning has been removed from Fleet Portal.' },
    { status: 410 },
  )
}
