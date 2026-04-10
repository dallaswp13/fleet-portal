'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Issue {
  id: string; title: string; body: string | null; status: string
  priority: string; notes_log: { text: string; ts: string; author: string }[]
  vehicle_number: number | null
  created_at: string; resolved_at: string | null; resolved_by: string | null
}

function Spinner() {
  return <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
}

function IssueCard({ issue, onUpdate }: { issue: Issue; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [vNumEdit, setVNumEdit] = useState(String(issue.vehicle_number ?? ''))
  const [saving, setSaving] = useState(false)

  async function addNote() {
    if (!noteText.trim()) return
    setSaving(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const entry = { text: noteText.trim(), ts: new Date().toISOString(), author: user?.email ?? 'admin' }
    const updatedLog = [entry, ...issue.notes_log]
    const vNum = vNumEdit ? parseInt(vNumEdit) : null

    await sb.from('issues').update({
      notes_log: updatedLog,
      vehicle_number: vNum ?? issue.vehicle_number,
      updated_at: new Date().toISOString()
    }).eq('id', issue.id)

    if (vNum) {
      const { data: veh } = await sb.from('vehicles').select('id,notes').eq('vehicle_number', vNum).limit(1).single()
      if (veh) {
        let vNotes: { text: string; ts: string }[] = []
        try { vNotes = JSON.parse(veh.notes ?? '[]') } catch { vNotes = [] }
        vNotes.unshift({ text: `[Issue: ${issue.title}] ${noteText.trim()}`, ts: entry.ts })
        await sb.from('vehicles').update({ notes: JSON.stringify(vNotes), updated_at: new Date().toISOString() }).eq('id', veh.id)
      }
    }

    setNoteText(''); setSaving(false); onUpdate()
  }

  async function resolve() {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('issues').update({ status: 'resolved', resolved_by: user?.email, resolved_at: new Date().toISOString() }).eq('id', issue.id)
    onUpdate()
  }

  async function reopen() {
    const sb = createClient()
    await sb.from('issues').update({ status: 'open', resolved_by: null, resolved_at: null }).eq('id', issue.id)
    onUpdate()
  }

  const priorityColor = issue.priority === 'high' ? 'var(--red)' : issue.priority === 'low' ? 'var(--text3)' : 'var(--amber)'

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: issue.status === 'resolved' ? 'var(--green)' : priorityColor, flexShrink: 0, marginTop: 6 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <div style={{ fontWeight: 600, fontSize: 13, textDecoration: issue.status === 'resolved' ? 'line-through' : undefined, opacity: issue.status === 'resolved' ? 0.6 : 1 }}>{issue.title}</div>
            {issue.vehicle_number && (
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>#{issue.vehicle_number}</span>
            )}
          </div>
          {issue.body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{issue.body}</div>}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {issue.status === 'resolved'
              ? `Resolved ${issue.resolved_at ? new Date(issue.resolved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''} by ${issue.resolved_by?.split('@')[0] ?? 'unknown'}`
              : `Opened ${new Date(issue.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {issue.notes_log.length > 0 && ` · ${issue.notes_log.length} note${issue.notes_log.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn-secondary btn-sm" onClick={() => setExpanded(e => !e)}>{expanded ? 'Hide' : 'Notes'}</button>
          {issue.status === 'open' ? (
            <button className="btn-secondary btn-sm" style={{ color: 'var(--green)' }} onClick={resolve}>✓ Resolve</button>
          ) : (
            <button className="btn-secondary btn-sm" style={{ color: 'var(--amber)' }} onClick={reopen}>↩ Reopen</button>
          )}
        </div>
      </div>
      {expanded && (
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
          {issue.status === 'open' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={vNumEdit} onChange={e => setVNumEdit(e.target.value)}
                  placeholder="Vehicle #" style={{ width: 90, fontSize: 12, flexShrink: 0 }} />
                <input value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Add a note…" style={{ flex: 1, fontSize: 12 }} />
                <button className="btn-primary btn-sm" onClick={addNote} disabled={saving || !noteText.trim()}>Add</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                Notes with a vehicle # are also added to that vehicle&apos;s Notes tab.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function RyloTrackerPage() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [addingIssue, setAddingIssue] = useState(false)
  const [tab, setTab] = useState<'open' | 'resolved'>('open')

  const loadIssues = useCallback(async () => {
    const sb = createClient()
    const { data } = await sb.from('issues').select('*').order('created_at', { ascending: false })
    setIssues((data ?? []) as Issue[])
    setLoading(false)
  }, [])

  useEffect(() => { loadIssues() }, [loadIssues])

  async function addIssue() {
    if (!newIssueTitle.trim()) return
    setAddingIssue(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('issues').insert({ title: newIssueTitle.trim(), notes_log: [], created_by: user?.email ?? 'admin' })
    setNewIssueTitle(''); setAddingIssue(false); loadIssues()
  }

  const openIssues = issues.filter(i => i.status === 'open')
  const resolvedIssues = issues.filter(i => i.status === 'resolved')
  const displayed = tab === 'open' ? openIssues : resolvedIssues

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Rylo Tracker</h1>
          <p>Track fleet issues, maintenance, and follow-ups</p>
        </div>
      </div>

      {/* Add new issue */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={newIssueTitle} onChange={e => setNewIssueTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addIssue()}
          placeholder="Add a new issue…" style={{ flex: 1 }} />
        <button className="btn-primary btn-sm" onClick={addIssue} disabled={addingIssue || !newIssueTitle.trim()}>
          {addingIssue ? <Spinner /> : '+ Add Issue'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button className={tab === 'open' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => setTab('open')}>Open ({openIssues.length})</button>
        <button className={tab === 'resolved' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => setTab('resolved')}>Resolved ({resolvedIssues.length})</button>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : displayed.length === 0 ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          {tab === 'open' ? '✓ No open issues.' : 'No resolved issues yet.'}
        </div>
      ) : (
        displayed.map(i => <IssueCard key={i.id} issue={i} onUpdate={loadIssues} />)
      )}
    </div>
  )
}
