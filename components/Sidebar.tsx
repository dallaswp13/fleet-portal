'use client'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const mainNav = [
  { href: '/',          label: 'Dashboard',     icon: '◉'  },
  { href: '/actions',   label: 'Quick Actions',  icon: '⚡' },
  { href: '/vehicles',  label: 'Vehicles',       icon: '🚕' },
  { href: '/devices',   label: 'Devices',        icon: '📱' },
  { href: '/lines',     label: 'Verizon',         icon: '📡' },
  { href: '/drivers',   label: 'Drivers',         icon: '🧑‍✈️' },
  { href: '/sms',       label: 'Inbox',            icon: '💬' },
  { href: '/rylo',      label: 'Rylo Tracker',     icon: '📋' },
]

const settingsNav = [
  { href: '/settings',  label: 'Settings',  icon: '⚙️' },
]

export default function Sidebar({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isSettings = pathname === '/settings' || pathname === '/audit'

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Image src="/logo.png" alt="Logo" width={42} height={42} style={{ borderRadius: 8, flexShrink: 0 }} />
        <div>
          <span>yellow.taxi</span>
        </div>
      </div>

      <div className="sidebar-sections-wrap">
      <div className="sidebar-section">
        <div className="sidebar-section-label">Navigation</div>
        {mainNav
          .filter(item => {
            if (item.href === '/sms' || item.href === '/rylo') return isAdmin
            return true
          })
          .map(item => (
            <Link key={item.href} href={item.href}
              className={`nav-item ${pathname === item.href ? 'active' : ''}`}>
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Admin</div>
        {settingsNav.map(item => (
          <Link key={item.href} href={item.href}
            className={`nav-item ${(pathname === item.href || (item.href === '/settings' && isSettings)) ? 'active' : ''}`}>
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>

      </div>

      {/* Always pinned to bottom of sidebar */}
      <div style={{ marginTop: 'auto', padding: '12px 8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ padding: '8px 10px', marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Signed in as</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userEmail}</div>
        </div>
        <button className="nav-item btn-ghost w-full" onClick={handleSignOut}
          style={{ justifyContent: 'flex-start', border: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  )
}
