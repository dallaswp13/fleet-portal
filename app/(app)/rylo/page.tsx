'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Issue {
  id: string; title: string; body: string | null; status: string
  priority: string; notes_log: { text: string; ts: string; author: string }[]
  vehicle_number: number | null
  created_at: string; resolved_at: string | null; resolved_by: string | null
  created_by: string | null
}

const PRIORITIES: { value: string; label: string; color: string }[] = [
  { value: 'high',   label: 'High',   color: 'var(--red)' },
  { value: 'medium', label: 'Medium', color: 'var(--amber)' },
  { value: 'low',    label: 'Low',    color: 'var(--text3)' },
]

const STATUSES: { value: string; label: string }[] = [
  { value: 'open',     label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
]

function Spinner() {
  return <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
}

function PriorityDot({ priority, size = 8 }: { priority: string; size?: number }) {
  const p = PRIORITIES.find(p => p.value === priority) ?? PRIORITIES[1]
  return <div style={{ width: size, height: size, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
}

/* ── Issue Card ───────────────────────────────────────────────── */
function IssueCard({ issue, onUpdate, isAdmin }: { issue: Issue; onUpdate: () => void; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteVehicle, setNoteVehicle] = useState('')
  const [saving, setSaving] = useState(false)

  // Editable fields
  const [editTitle, setEditTitle] = useState(issue.title)
  const [editBody, setEditBody] = useState(issue.body ?? '')
  const [editPriority, setEditPriority] = useState(issue.priority)
  const [editStatus, setEditStatus] = useState(issue.status)

  function startEdit() {
    setEditTitle(issue.title)
    setEditBody(issue.body ?? '')
    setEditPriority(issue.priority)
    setEditStatus(issue.status)
    setEditing(true)
    setExpanded(true)
  }

  async function saveEdit() {
    setSaving(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()

    const updates: Record<string, unknown> = {
      title: editTitle.trim(),
      body: editBody.trim() || null,
      priority: editPriority,
      status: editStatus,
      updated_at: new Date().toISOString(),
    }

    // If status changed to resolved, record who/when
    if (editStatus === 'resolved' && issue.status !== 'resolved') {
      updates.resolved_by = user?.email
      updates.resolved_at = new Date().toISOString()
    }
    // If reopened, clear resolution
    if (editStatus === 'open' && issue.status === 'resolved') {
      updates.resolved_by = null
      updates.resolved_at = null
    }

    await sb.from('issues').update(updates).eq('id', issue.id)
    setSaving(false)
    setEditing(false)
    onUpdate()
  }

  async function addNote() {
    if (!noteText.trim()) return
    setSaving(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    let noteContent = noteText.trim()
    if (noteVehicle.trim()) {
      noteContent = `[Vehicle #${noteVehicle.trim()}] ${noteContent}`
    }
    const entry = { text: noteContent, ts: new Date().toISOString(), author: user?.email ?? 'admin' }
    const updatedLog = [entry, ...issue.notes_log]
    const vNum = noteVehicle ? parseInt(noteVehicle) || null : null

    await sb.from('issues').update({
      notes_log: updatedLog,
      updated_at: new Date().toISOString()
    }).eq('id', issue.id)

    // Cross-post note to vehicle if linked
    if (vNum) {
      const { data: veh } = await sb.from('vehicles').select('id,notes').eq('vehicle_number', vNum).limit(1).single()
      if (veh) {
        let vNotes: { text: string; ts: string }[] = []
        try { vNotes = JSON.parse(veh.notes ?? '[]') } catch { vNotes = [] }
        vNotes.unshift({ text: `[Issue: ${issue.title}] ${noteContent}`, ts: entry.ts })
        await sb.from('vehicles').update({ notes: JSON.stringify(vNotes), updated_at: new Date().toISOString() }).eq('id', veh.id)
      }
    }

    setNoteText(''); setNoteVehicle(''); setSaving(false); onUpdate()
  }

  const priorityDef = PRIORITIES.find(p => p.value === issue.priority) ?? PRIORITIES[1]
  const isResolved = issue.status === 'resolved'

  return (
    <div style={{ background: 'var(--bg2)', border: `1px solid ${editing ? priorityDef.color : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 10, transition: 'border-color 0.15s' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <PriorityDot priority={issue.priority} size={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
              style={{ width: '100%', fontWeight: 600, fontSize: 13, marginBottom: 6 }} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, fontSize: 13, opacity: isResolved ? 0.5 : 1, textDecoration: isResolved ? 'line-through' : undefined }}>{issue.title}</div>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: `${priorityDef.color}22`, color: priorityDef.color, fontWeight: 600 }}>
                {priorityDef.label}
              </span>
              {isResolved && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'var(--green)', color: '#fff', fontWeight: 600 }}>Resolved</span>}
            </div>
          )}
          {!editing && issue.body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{issue.body}</div>}
          {!editing && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {isResolved
                ? `Resolved ${issue.resolved_at ? new Date(issue.resolved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''} by ${issue.resolved_by?.split('@')[0] ?? 'unknown'}`
                : `Opened ${new Date(issue.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
              {issue.notes_log.length > 0 && ` · ${issue.notes_log.length} note${issue.notes_log.length !== 1 ? 's' : ''}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!editing && <button className="btn-secondary btn-sm" onClick={() => setExpanded(e => !e)}>{expanded ? 'Hide' : 'Notes'}</button>}
          <button className="btn-secondary btn-sm" onClick={editing ? saveEdit : startEdit} disabled={saving}>
            {saving ? <Spinner /> : editing ? 'Save' : 'Edit'}
          </button>
          {editing && <button className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>Description</div>
            <textarea value={editBody} onChange={e => setEditBody(e.target.value)}
              placeholder="Optional description…"
              style={{ width: '100%', minHeight: 60, fontSize: 12, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>Priority</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {PRIORITIES.map(p => (
                  <button key={p.value} onClick={() => setEditPriority(p.value)}
                    style={{
                      padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius)', cursor: 'pointer',
                      border: editPriority === p.value ? `2px solid ${p.color}` : '1px solid var(--border)',
                      background: editPriority === p.value ? `${p.color}18` : 'var(--bg3)',
                      color: editPriority === p.value ? p.color : 'var(--text2)',
                      fontWeight: editPriority === p.value ? 600 : 400,
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {isAdmin && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>Status</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {STATUSES.map(s => (
                    <button key={s.value} onClick={() => setEditStatus(s.value)}
                      style={{
                        padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius)', cursor: 'pointer',
                        border: editStatus === s.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: editStatus === s.value ? 'var(--accent-bg)' : 'var(--bg3)',
                        fontWeight: editStatus === s.value ? 600 : 400,
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notes section (when expanded but not editing) */}
      {expanded && !editing && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {issue.notes_log.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {issue.notes_log.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <div style={{ color: 'var(--text3)', whiteSpace: 'nowrap', fontSize: 11, paddingTop: 1, minWidth: 100 }}>
                    {new Date(n.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 6 }}>{n.author?.split('@')[0]}</span>
                    {n.text}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={noteText} onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Add a note…" style={{ flex: 1, minWidth: 200, fontSize: 12 }} />
            <input value={noteVehicle} onChange={e => setNoteVehicle(e.target.value)}
              placeholder="Vehicle # (optional)" style={{ width: 120, fontSize: 12 }} />
            <button className="btn-primary btn-sm" onClick={addNote} disabled={saving || !noteText.trim()}>Add</button>
          </div>
          {noteVehicle && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Note will be added to vehicle #{noteVehicle}&apos;s Notes tab.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function RyloTrackerPage() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [isAdmin, setIsAdmin] = useState(false)

  // New issue form
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [addingIssue, setAddingIssue] = useState(false)

  const loadIssues = useCallback(async () => {
    const sb = createClient()
    const { data } = await sb.from('issues').select('*').order('created_at', { ascending: false })
    setIssues((data ?? []) as Issue[])
    setLoading(false)
  }, [])

  useEffect(() => {
    async function checkAdminStatus() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (user?.email) {
        const { data: profile } = await sb.from('user_profiles').select('is_admin').eq('email', user.email).single()
        setIsAdmin(profile?.is_admin ?? false)
      }
    }
    loadIssues()
    checkAdminStatus()
  }, [loadIssues])

  async function addIssue() {
    if (!newTitle.trim()) return
    setAddingIssue(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('issues').insert({
      title: newTitle.trim(),
      body: newBody.trim() || null,
      priority: newPriority,
      vehicle_number: null,
      notes_log: [],
      created_by: user?.email ?? 'admin'
    })
    setNewTitle(''); setNewBody(''); setNewPriority('medium')
    setAddingIssue(false); setShowNew(false); loadIssues()
  }

  const priorityWeight: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const sortByPriority = (a: Issue, b: Issue) => (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1)
  const openIssues = issues.filter(i => i.status === 'open').sort(sortByPriority)
  const resolvedIssues = issues.filter(i => i.status === 'resolved')
  const displayed = tab === 'open' ? openIssues : resolvedIssues

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Rylo Tracker</h1>
          <p>Track fleet issues, maintenance, and follow-ups</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(s => !s)}>
          {showNew ? 'Cancel' : '+ New Issue'}
        </button>
      </div>

      {/* New issue form */}
      {showNew && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)', padding: '16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus
              placeholder="Issue title" style={{ fontWeight: 600, fontSize: 13 }} />
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)}
              placeholder="Description (optional)" style={{ minHeight: 50, fontSize: 12, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>Priority</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {PRIORITIES.map(p => (
                    <button key={p.value} onClick={() => setNewPriority(p.value)}
                      style={{
                        padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius)', cursor: 'pointer',
                        border: newPriority === p.value ? `2px solid ${p.color}` : '1px solid var(--border)',
                        background: newPriority === p.value ? `${p.color}18` : 'var(--bg3)',
                        color: newPriority === p.value ? p.color : 'var(--text2)',
                        fontWeight: newPriority === p.value ? 600 : 400,
                      }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn-primary" onClick={addIssue} disabled={addingIssue || !newTitle.trim()}
                style={{ marginLeft: 'auto' }}>
                {addingIssue ? <Spinner /> : 'Create Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ marginBottom: 14 }}>
        <div className="toggle-group">
          <button className={`toggle-btn ${tab === 'open' ? 'toggle-active' : ''}`}
            onClick={() => setTab('open')}>Open ({openIssues.length})</button>
          <button className={`toggle-btn ${tab === 'resolved' ? 'toggle-active' : ''}`}
            onClick={() => setTab('resolved')}>Resolved ({resolvedIssues.length})</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : displayed.length === 0 ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          {tab === 'open' ? 'No open issues.' : 'No resolved issues yet.'}
        </div>
      ) : (
        displayed.map(i => <IssueCard key={i.id} issue={i} onUpdate={loadIssues} isAdmin={isAdmin} />)
      )}
    </div>
  )
}
