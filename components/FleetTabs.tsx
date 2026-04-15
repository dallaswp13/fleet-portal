'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Sub-tab strip rendered at the top of every /fleet/* page. Lives in its
 * own client component because `usePathname` requires a client boundary
 * and we want the surrounding layout to be server-rendered.
 */
const TABS = [
  { href: '/fleet/vehicles', label: 'Vehicles', icon: '🚕' },
  { href: '/fleet/devices',  label: 'Devices',  icon: '📱' },
  { href: '/fleet/lines',    label: 'Verizon',  icon: '📡' },
]

export default function FleetTabs() {
  const pathname = usePathname()

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '0 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      {TABS.map(tab => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: '14px 18px',
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--text)' : 'var(--text2)',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              transition: 'color 120ms ease',
            }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
