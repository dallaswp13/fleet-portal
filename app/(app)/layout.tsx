import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import ClaudeSupportToggle from '@/components/ClaudeSupportToggle'
import M360StatusIndicator from '@/components/M360StatusIndicator'
import TwilioStatusIndicator from '@/components/TwilioStatusIndicator'
import BalanceIndicator from '@/components/BalanceIndicator'
import { Suspense } from 'react'
import OfficeFilter from '@/components/OfficeFilter'
import { OFFICES, type Office } from '@/lib/filters'
import { getCachedUser, getCachedProfile, getCachedIsAdmin } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Run user, profile, and admin checks in parallel — they share a single
  // network round-trip thanks to React's cache() in lib/auth.ts.
  const [user, profile, isAdmin] = await Promise.all([
    getCachedUser(),
    getCachedProfile(),
    getCachedIsAdmin(),
  ])
  if (!user) redirect('/login')

  // Which offices this user is allowed to see — passed to OfficeFilter so it
  // only renders pills for their permitted offices.
  // null = unrestricted (admins), [] = no access, [...] = specific offices
  const allowedOffices: Office[] | null = isAdmin
    ? null
    : !profile
      ? []
      : profile.offices === null
        ? []
        : (profile.offices).filter((o): o is Office => OFFICES.includes(o as Office))

  return (
    <div className="app-shell">
      <Sidebar userEmail={user.email ?? ''} isAdmin={isAdmin} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar">
          <div className="topbar-filters">
            <Suspense>
              <OfficeFilter allowedOffices={allowedOffices} />
            </Suspense>
          </div>
          <div className="topbar-actions">
            <BalanceIndicator />
            <TwilioStatusIndicator />
            <M360StatusIndicator />
            <ClaudeSupportToggle />
            <ThemeToggle />
          </div>
        </div>
        <main className="main">
          {children}
        </main>
      </div>
    </div>
  )
}
