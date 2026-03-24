import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import ClaudeSupportToggle from '@/components/ClaudeSupportToggle'
import M360StatusIndicator from '@/components/M360StatusIndicator'
import { Suspense } from 'react'
import OfficeFilter from '@/components/OfficeFilter'
import { OFFICES, type Office } from '@/lib/filters'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin, offices')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.is_admin === true || user.email === (process.env.ADMIN_EMAIL ?? '')

  // Which offices this user is allowed to see — passed to OfficeFilter so it
  // only renders pills for their permitted offices.
  // null = unrestricted (admins), [] = no access, [...] = specific offices
  const allowedOffices: Office[] | null = isAdmin
    ? null
    : !profile
      ? []
      : profile.offices === null
        ? []
        : (profile.offices as string[]).filter((o): o is Office => OFFICES.includes(o as Office))

  return (
    <div className="app-shell">
      <Sidebar userEmail={user.email ?? ''} isAdmin={isAdmin} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar">
          <Suspense>
            <OfficeFilter allowedOffices={allowedOffices} />
          </Suspense>
          <div style={{ flex: 1 }} />
          <M360StatusIndicator />
          <ClaudeSupportToggle />
          <ThemeToggle />
        </div>
        <main className="main">
          {children}
        </main>
      </div>
    </div>
  )
}
