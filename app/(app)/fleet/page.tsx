import { redirect } from 'next/navigation'

export default function FleetIndex() {
  // /fleet has no content of its own — send users to the Vehicles view by default.
  redirect('/fleet/vehicles')
}
