import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import { Suspense } from 'react'
import OfficeFilter from '@/components/OfficeFilter'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="app-shell">
      <Sidebar userEmail={user.email ?? ''} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar">
          <Suspense>
            <OfficeFilter />
          </Suspense>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
        </div>
        <main className="main">
          {children}
        </main>
      </div>
    </div>
  )
}
