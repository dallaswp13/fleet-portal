'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AuditSection, Severity } from '@/lib/audit-checks'
import { ROW_KEY_FOR_SECTION } from '@/lib/audit-checks'
import { toast } from '@/components/Toaster'

const SEVERITY_META: Record<Severity, { color: string; label: string; order: number }> = {
  critical: { color: 'var(--red)',    label: 'Critical', order: 0 },
  high:     { color: '#e67e22',       label: 'High',     order: 1 },
  medium:   { color: 'var(--amber)',  label: 'Medium',   order: 2 },
  low:      { color: 'var(--text2)',  label: 'Low',      order: 3 },
  info:     { color: 'var(--text3)',  label: 'Info',     order: 4 },
}

export interface IgnoredItem {
  section_id: string
  row_key:    string
  reason:     string | null
  ignored_by: string
  ignored_at: string
}

function toCSV(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(c.label)).join(',')
  const body   = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\n')
  return header + '\n' + body
}

function downloadCSV(section: AuditSection) {
  const csv = toCSV(section.rows, section.columns)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-${section.id}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function DataAuditorView({
  sections, runAt, ignoredList = [],
}: {
  sections: AuditSection[]
  runAt: string
  ignoredList?: IgnoredItem[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function setIgnored(action: 'ignore' | 'unignore', sectionId: string, rowKey: string, reason?: string) {
    const res = await fetch('/api/audit-ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sectionId, rowKey, reason }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      toast.error(`Failed to ${action}`, { detail: txt.slice(0, 120) || 'Server error' })
      return
    }
    toast.success(action === 'ignore' ? 'Item ignored' : 'Item restored', {
      detail: action === 'ignore' ? 'Hidden from future audit runs' : 'Will reappear on next run',
    })
    // Server components regenerate the sections + ignoredList on refresh.
    startTransition(() => router.refresh())
  }

  const ordered = [...sections].sort((a, b) => {
    const sa = SEVERITY_META[a.severity].order
    const sb = SEVERITY_META[b.severity].order
    if (sa !== sb) return sa - sb
    return b.count - a.count
  })

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    // Auto-expand anything non-zero
    const m: Record<string, boolean> = {}
    for (const s of ordered) if (s.count > 0) m[s.id] = true
    return m
  })

  const [showIgnored, setShowIgnored] = useState(false)

  const critical = ordered.filter(s => s.severity === 'critical' && s.count > 0)
  const high     = ordered.filter(s => s.severity === 'high'     && s.count > 0)
  const medium   = ordered.filter(s => s.severity === 'medium'   && s.count > 0)
  const cleanCount = ordered.filter(s => s.count === 0).length

  return (
    <>
      {/* Top summary */}
      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <StatCard label="Critical issues" value={critical.reduce((n, s) => n + s.count, 0)} color="var(--red)"   sub={`${critical.length} checks`} />
        <StatCard label="High"            value={high.reduce((n, s) => n + s.count, 0)}     color="#e67e22"     sub={`${high.length} checks`} />
        <StatCard label="Medium"          value={medium.reduce((n, s) => n + s.count, 0)}   color="var(--amber)" sub={`${medium.length} checks`} />
        <StatCard label="Passing"         value={cleanCount}                                color="var(--green)" sub={`of ${ordered.length}`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, fontSize: 11, color: 'var(--text3)' }}>
        <div>
          Last run: {new Date(runAt).toLocaleString()} &nbsp;·&nbsp; Reload the page to run again.
        </div>
        {ignoredList.length > 0 && (
          <button className="btn-secondary btn-sm" onClick={() => setShowIgnored(v => !v)}>
            {showIgnored ? 'Hide' : 'Show'} ignored ({ignoredList.length})
          </button>
        )}
      </div>

      {/* Ignored items panel — collapsed by default, expanded on demand so
          the user can un-ignore items when a previous decision goes stale. */}
      {showIgnored && (
        <div className="card" style={{ padding: 12, marginBottom: 16, borderLeft: '3px solid var(--text3)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Ignored items ({ignoredList.length})</div>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Row key</th>
                  <th>Reason</th>
                  <th>Ignored by</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ignoredList.map(ig => (
                  <tr key={`${ig.section_id}|${ig.row_key}`}>
                    <td style={{ fontSize: 11 }}>{ig.section_id}</td>
                    <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{ig.row_key}</td>
                    <td style={{ fontSize: 11 }}>{ig.reason || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                    <td style={{ fontSize: 11 }}>{ig.ignored_by}</td>
                    <td style={{ fontSize: 11 }}>{new Date(ig.ignored_at).toLocaleString()}</td>
                    <td>
                      <button
                        className="btn-secondary btn-sm"
                        disabled={pending}
                        onClick={() => setIgnored('unignore', ig.section_id, ig.row_key)}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ordered.map(section => {
          const meta = SEVERITY_META[section.severity]
          const isOpen = !!open[section.id]
          const clean  = section.count === 0
          // Sections not in ROW_KEY_FOR_SECTION (e.g. freshness) don't support
          // per-row ignoring.
          const keyFn = ROW_KEY_FOR_SECTION[section.id]
          // freshness is registered but returns null → still not ignorable.
          const canIgnore = !!keyFn && keyFn({ probe: 1 }) !== null
          return (
            <div key={section.id} className="card" style={{
              padding: 0,
              borderLeft: `3px solid ${clean ? 'var(--green)' : meta.color}`,
              opacity: clean ? 0.75 : 1,
            }}>
              <button
                onClick={() => setOpen(p => ({ ...p, [section.id]: !p[section.id] }))}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '14px 16px',
                  background: 'transparent', border: 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer', color: 'inherit',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: clean ? 'var(--green)' : meta.color,
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {clean ? '✓' : section.count}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{section.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {section.description}
                    {section.ignoredCount && section.ignoredCount > 0 ? (
                      <span style={{ marginLeft: 6, color: 'var(--text3)', fontStyle: 'italic' }}>
                        ({section.ignoredCount} ignored, hidden)
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="tag" style={{ background: clean ? 'transparent' : `${meta.color}22`, color: clean ? 'var(--green)' : meta.color, borderColor: clean ? 'var(--green)' : meta.color }}>
                  {meta.label.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)', width: 14, textAlign: 'center' }}>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '0 16px 16px 16px' }}>
                  {clean ? (
                    <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>
                      No issues detected. ✓
                    </div>
                  ) : (
                    <>
                      {section.remediation && (
                        <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', marginBottom: 10 }}>
                          <strong>How to resolve:</strong> {section.remediation}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                          Showing {Math.min(section.rows.length, 100)} of {section.rows.length}
                        </span>
                        <button className="btn-secondary btn-sm" onClick={() => downloadCSV(section)}>
                          ⬇ Download CSV
                        </button>
                      </div>
                      <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                        <table>
                          <thead>
                            <tr>
                              {section.columns.map(c => <th key={c.key}>{c.label}</th>)}
                              {canIgnore && <th style={{ width: 90 }}></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {section.rows.slice(0, 100).map((r, i) => {
                              const rowKey = (r._rowKey as string | undefined) ?? null
                              return (
                                <tr key={i}>
                                  {section.columns.map(c => (
                                    <td key={c.key} style={{ fontSize: 12 }}>
                                      {r[c.key] == null || r[c.key] === '' ? <span style={{ color: 'var(--text3)' }}>—</span> : String(r[c.key])}
                                    </td>
                                  ))}
                                  {canIgnore && (
                                    <td style={{ textAlign: 'right' }}>
                                      {rowKey ? (
                                        <button
                                          className="btn-secondary btn-sm"
                                          disabled={pending}
                                          title="Hide from future audit runs"
                                          onClick={() => {
                                            const reason = window.prompt('Reason for ignoring this item? (optional)') ?? undefined
                                            setIgnored('ignore', section.id, rowKey, reason || undefined)
                                          }}
                                        >
                                          Ignore
                                        </button>
                                      ) : null}
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>
    </div>
  )
}
