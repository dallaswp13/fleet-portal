'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { OFFICES, SHEET_TABS, OFFICE_COLORS, type Office, type SheetTab } from '@/lib/filters'

// ASC is last in display order
const DISPLAY_ORDER: Office[] = ['CYC', 'SDY', 'DEN', 'ASC']

// ASC sub-fleets
export const ASC_FLEETS = ['E', 'L', 'S', 'Y', 'U'] as const
export type AscFleet = typeof ASC_FLEETS[number]
const ASC_FLEET_LABELS: Record<AscFleet, string> = { E: 'E', L: 'L', S: 'S', Y: 'Y', U: 'U' }

const TAB_LABELS: Record<SheetTab, string> = {
  'Active Vehicles': 'Active',
  'Test Vehicles':   'Test',
  'Surrenders':      'Surrendered',
}
const TAB_COLORS: Record<SheetTab, string> = {
  'Active Vehicles': 'var(--green)',
  'Test Vehicles':   'var(--amber)',
  'Surrenders':      'var(--red)',
}

function parseOffices(param: string | null): Set<Office> {
  if (!param) return new Set(OFFICES)
  const vals = param.split(',').filter((o): o is Office => OFFICES.includes(o as Office))
  return new Set(vals.length ? vals : OFFICES)
}

function parseAscFleets(param: string | null): Set<AscFleet> {
  if (!param) return new Set(ASC_FLEETS)
  const vals = param.split(',').filter((f): f is AscFleet => ASC_FLEETS.includes(f as AscFleet))
  return new Set(vals.length ? vals : ASC_FLEETS)
}

function parseTabs(param: string | null): Set<SheetTab> {
  if (!param) return new Set(['Active Vehicles', 'Test Vehicles'] as SheetTab[])
  const vals = param.split(',').filter((t): t is SheetTab => SHEET_TABS.includes(t as SheetTab))
  return new Set(vals.length ? vals : SHEET_TABS)
}

export default function OfficeFilter() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [offices,    setOffices]    = useState<Set<Office>>(() => parseOffices(searchParams.get('offices')))
  const [ascFleets,  setAscFleets]  = useState<Set<AscFleet>>(() => parseAscFleets(searchParams.get('asc_fleets')))
  const [tabs,       setTabs]       = useState<Set<SheetTab>>(() => parseTabs(searchParams.get('tabs')))

  useEffect(() => {
    // Read persisted filters from localStorage when URL has no params
    // Then immediately push URL so server components render with correct params
    let o = offices, t = tabs, asc = ascFleets
    let changed = false

    if (!searchParams.get('offices')) {
      try {
        const s = localStorage.getItem('office-filter')
        if (s) {
          const parsed = new Set<Office>(JSON.parse(s).filter((x: string): x is Office => OFFICES.includes(x as Office)))
          if (parsed.size && parsed.size !== OFFICES.length) { o = parsed; changed = true }
        }
      } catch {}
    }
    if (!searchParams.get('tabs')) {
      try {
        const s = localStorage.getItem('tab-filter')
        if (s) {
          const parsed = new Set<SheetTab>(JSON.parse(s).filter((x: string): x is SheetTab => SHEET_TABS.includes(x as SheetTab)))
          if (parsed.size && parsed.size !== SHEET_TABS.length) { t = parsed; changed = true }
        }
      } catch {}
    }
    if (!searchParams.get('asc_fleets')) {
      try {
        const s = localStorage.getItem('asc-fleet-filter')
        if (s) {
          const parsed = new Set<AscFleet>(JSON.parse(s).filter((x: string): x is AscFleet => ASC_FLEETS.includes(x as AscFleet)))
          if (parsed.size && parsed.size !== ASC_FLEETS.length) { asc = parsed; changed = true }
        }
      } catch {}
    }

    if (changed) {
      // Push URL immediately so server re-renders with correct filters
      setOffices(o); setTabs(t); setAscFleets(asc)
      const p = new URLSearchParams(searchParams.toString())
      o.size === OFFICES.length ? p.delete('offices') : p.set('offices', Array.from(o).join(','))
      t.size === SHEET_TABS.length ? p.delete('tabs') : p.set('tabs', Array.from(t).join(','))
      asc.size === ASC_FLEETS.length ? p.delete('asc_fleets') : p.set('asc_fleets', Array.from(asc).join(','))
      router.replace(`${pathname}?${p.toString()}`)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function apply(nextOffices: Set<Office>, nextTabs: Set<SheetTab>, nextAscFleets: Set<AscFleet>) {
    setOffices(nextOffices); setTabs(nextTabs); setAscFleets(nextAscFleets)
    try {
      localStorage.setItem('office-filter',    JSON.stringify(Array.from(nextOffices)))
      localStorage.setItem('tab-filter',       JSON.stringify(Array.from(nextTabs)))
      localStorage.setItem('asc-fleet-filter', JSON.stringify(Array.from(nextAscFleets)))
    } catch {}

    const p = new URLSearchParams(searchParams.toString())
    p.delete('page')
    nextOffices.size === OFFICES.length ? p.delete('offices') : p.set('offices', Array.from(nextOffices).join(','))
    nextTabs.size === SHEET_TABS.length ? p.delete('tabs') : p.set('tabs', Array.from(nextTabs).join(','))
    nextAscFleets.size === ASC_FLEETS.length ? p.delete('asc_fleets') : p.set('asc_fleets', Array.from(nextAscFleets).join(','))
    router.push(`${pathname}?${p.toString()}`)
  }

  function toggleOffice(o: Office) {
    const next = new Set(offices)
    if (next.has(o)) { next.delete(o) } else next.add(o)
    apply(next, tabs, ascFleets)
  }

  function toggleAscFleet(f: AscFleet) {
    const next = new Set(ascFleets)
    if (next.has(f)) { next.delete(f) } else next.add(f)
    apply(offices, tabs, next)
  }

  function toggleTab(t: SheetTab) {
    const next = new Set(tabs)
    if (next.has(t)) { next.delete(t) } else next.add(t)
    apply(offices, next, ascFleets)
  }

  const allOffices   = offices.size === OFFICES.length
  const allTabs      = tabs.size === SHEET_TABS.length
  const allAscFleets = ascFleets.size === ASC_FLEETS.length
  const ascSelected  = offices.has('ASC')

  function pill(active: boolean, color?: string, small = false): React.CSSProperties {
    const h = small ? 24 : 30
    const p = small ? '0 9px' : '0 13px'
    const f = small ? 11 : 13
    if (active && color) return { height: h, padding: p, fontSize: f, borderRadius: 100, background: color, border: `1px solid ${color}`, color: '#fff', cursor: 'pointer', fontWeight: 600, transition: 'all 0.12s', whiteSpace: 'nowrap' as const }
    if (active)          return { height: h, padding: p, fontSize: f, borderRadius: 100, background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.12s', whiteSpace: 'nowrap' as const }
    return                      { height: h, padding: p, fontSize: f, borderRadius: 100, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', cursor: 'pointer', fontWeight: 400, transition: 'all 0.12s', whiteSpace: 'nowrap' as const }
  }

  const divider = <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {/* Office label */}
      <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Office</span>
      <button style={pill(allOffices)} onClick={() => allOffices ? apply(new Set(), tabs, new Set(ASC_FLEETS)) : apply(new Set(OFFICES), tabs, new Set(ASC_FLEETS))}>All</button>

      {/* CYC, SDY, DEN first */}
      {DISPLAY_ORDER.filter(o => o !== 'ASC').map(o => (
        <button key={o} style={pill(offices.has(o), OFFICE_COLORS[o])} onClick={() => toggleOffice(o)}>{o}</button>
      ))}

      {/* ASC last */}
      <button style={pill(offices.has('ASC'), OFFICE_COLORS['ASC'])} onClick={() => toggleOffice('ASC')}>ASC</button>

      {/* ASC sub-fleet pills — only visible when ASC is selected */}
      {ascSelected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: `${OFFICE_COLORS['ASC']}18`, borderRadius: 100, border: `1px solid ${OFFICE_COLORS['ASC']}44` }}>
          <span style={{ fontSize: 9, color: OFFICE_COLORS['ASC'], fontWeight: 700, letterSpacing: '0.06em' }}>ASC:</span>
          <button style={pill(allAscFleets, undefined, true)} onClick={() => allAscFleets ? apply(offices, tabs, new Set()) : apply(offices, tabs, new Set(ASC_FLEETS))}>All</button>
          {ASC_FLEETS.map(f => (
            <button key={f} style={pill(ascFleets.has(f), OFFICE_COLORS['ASC'], true)} onClick={() => toggleAscFleet(f)}>{f}</button>
          ))}
        </div>
      )}

      {divider}

      {/* Status filter */}
      <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Status</span>
      <button style={pill(allTabs)} onClick={() => allTabs ? apply(offices, new Set(), ascFleets) : apply(offices, new Set(SHEET_TABS), ascFleets)}>All</button>
      {SHEET_TABS.map(t => (
        <button key={t} style={pill(tabs.has(t), TAB_COLORS[t])} onClick={() => toggleTab(t)}>{TAB_LABELS[t]}</button>
      ))}
    </div>
  )
}
