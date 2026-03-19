'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/* ── Types ────────────────────────────────────────────────── */
interface Issue {
  id: string; title: string; body: string | null; status: string
  priority: string; notes_log: { text: string; ts: string; author: string }[]
  created_at: string; resolved_at: string | null
}

interface WorkflowStep {
  label: string; type: 'select' | 'input' | 'confirm' | 'result'; key?: string
  options?: { label: string; value: string }[]; placeholder?: string
}

interface QuickAction {
  id: string; icon: string; title: string; description: string; color: string
  steps?: WorkflowStep[]; toggle?: boolean; href?: string
}

/* ── Quick Actions config ─────────────────────────────────── */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'replace_tablet', icon: '📱', title: 'Replace Driver Tablet', color: 'var(--blue)',
    description: 'Assign a new driver tablet to a vehicle.',
    steps: [
      { label: 'Vehicle Number', type: 'input', key: 'vehicle_number', placeholder: 'e.g. 6020' },
      { label: 'Reason', type: 'select', key: 'reason', options: [
        { label: 'Screen damage', value: 'Screen damage' },
        { label: 'Device lost', value: 'Device lost' },
        { label: 'Battery failure', value: 'Battery failure' },
        { label: 'Software issue', value: 'Software issue' },
        { label: 'Other', value: 'Other' },
      ]},
      { label: 'Confirm', type: 'confirm' }, { label: '', type: 'result' },
    ],
  },
  {
    id: 'surrender_vehicle', icon: '🚕', title: 'Surrender Vehicle', color: 'var(--amber)',
    description: 'Mark a vehicle as surrendered and log the handoff.',
    steps: [
      { label: 'Vehicle Number', type: 'input', key: 'vehicle_number', placeholder: 'e.g. 6020' },
      { label: 'Type', type: 'select', key: 'surrender_type', options: [
        { label: 'Driver surrendered voluntarily', value: 'Voluntary' },
        { label: 'Lease expired', value: 'Lease expired' },
        { label: 'Accident / total loss', value: 'Total loss' },
        { label: 'Other', value: 'Other' },
      ]},
      { label: 'Notes (optional)', type: 'input', key: 'notes', placeholder: '' },
      { label: 'Confirm', type: 'confirm' }, { label: '', type: 'result' },
    ],
  },
  {
    id: 'remote_support', icon: '🛠', title: 'Remote Support', color: 'var(--green)',
    description: 'Initiate a remote support session for a driver.',
    steps: [
      { label: 'Vehicle Number', type: 'input', key: 'vehicle_number', placeholder: 'e.g. 6020' },
      { label: 'Issue', type: 'select', key: 'issue', options: [
        { label: 'App not loading', value: 'App not loading' },
        { label: 'No GPS', value: 'No GPS' },
        { label: 'Payment not working', value: 'Payment not working' },
        { label: 'Tablet frozen', value: 'Tablet frozen' },
        { label: 'Other', value: 'Other' },
      ]},
      { label: 'Confirm', type: 'confirm' }, { label: '', type: 'result' },
    ],
  },
  {
    id: 'log_issue', icon: '📋', title: 'Log an Issue', color: '#9b59b6',
    description: 'Record a tech issue for tracking and follow-up.',
    steps: [
      { label: 'Vehicle Number', type: 'input', key: 'vehicle_number', placeholder: 'e.g. 6020' },
      { label: 'Category', type: 'select', key: 'category', options: [
        { label: 'Tablet hardware', value: 'Tablet hardware' },
        { label: 'Tablet software', value: 'Tablet software' },
        { label: 'PIM / payment device', value: 'PIM' },
        { label: 'Meter connectivity', value: 'Meter' },
        { label: 'Verizon / SIM', value: 'Verizon' },
        { label: 'MaaS360 / MDM', value: 'MDM' },
        { label: 'Other', value: 'Other' },
      ]},
      { label: 'Description', type: 'input', key: 'description', placeholder: 'What is the problem?' },
      { label: 'Confirm', type: 'confirm' }, { label: '', type: 'result' },
    ],
  },
  {
    id: 'create_vehicle', icon: '🆕', title: 'Create Vehicle', color: '#1abc9c',
    description: 'Add a new vehicle record to the fleet database.',
    steps: [
      { label: 'Vehicle Number', type: 'input', key: 'vehicle_number', placeholder: 'e.g. 9999' },
      { label: 'Fleet', type: 'select', key: 'fleet_id', options: [
        { label: 'E (ASC)', value: 'E' }, { label: 'L (ASC)', value: 'L' },
        { label: 'S (ASC)', value: 'S' }, { label: 'Y (ASC)', value: 'Y' },
        { label: 'U (ASC)', value: 'U' }, { label: 'C (CYC)', value: 'C' },
        { label: 'G (SDY)', value: 'G' }, { label: 'D (DEN)', value: 'D' },
      ]},
      { label: 'Confirm', type: 'confirm' }, { label: '', type: 'result' },
    ],
  },
  {
    id: 'export_data', icon: '📤', title: 'Export Data', color: '#7f8c8d',
    description: 'Download fleet data as CSV.',
    href: '/vehicles',
  },
  {
    id: 'new_inbox_rule', icon: '⚙️', title: 'New Inbox Rule', color: '#e67e22',
    description: 'Create an automation rule for incoming SMS messages.',
    href: '/sms',
  }
]


/* ── Workflow Modal ────────────────────────────────────────── */
function WorkflowModal({ action, onClose }: { action: QuickAction; onClose: () => void }) {
  const [step,   setStep]   = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy,   setBusy]   = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const steps = action.steps ?? []
  const cur   = steps[step]

  async function advance() {
    if (cur.type === 'confirm') {
      setBusy(true)
      try {
        const sb = createClient()
        const { data: { user } } = await sb.auth.getUser()
        const vNum = parseInt(values.vehicle_number ?? '')

        if (action.id === 'create_vehicle') {
          const fleet = values.fleet_id ?? 'E'
          const nameKey = `${vNum}${fleet}`.toLowerCase()
          const { error } = await sb.from('vehicles').insert({
            vehicle_number: vNum, fleet_id: fleet,
            vehicle_name_key: nameKey,
            sheet_tab: 'Active Vehicles', updated_at: new Date().toISOString()
          })
          if (error) { setResult({ ok: false, msg: error.message }); setBusy(false); setStep(steps.length - 1); return }
          setResult({ ok: true, msg: `✓ Vehicle #${vNum} ${fleet} created successfully.` })
        } else if (vNum) {
          const { data: vehicle } = await sb.from('vehicles').select('id,fleet_id,notes,sheet_tab').eq('vehicle_number', vNum).single()
          if (!vehicle) { setResult({ ok: false, msg: `Vehicle #${vNum} not found in database.` }); setBusy(false); setStep(steps.length - 1); return }

          let noteLog: { text: string; ts: string }[] = []
          try { noteLog = vehicle.notes ? JSON.parse(vehicle.notes) : [] } catch { noteLog = [] }

          // Build note text
          const noteFields = Object.entries(values)
            .filter(([k]) => k !== 'vehicle_number' && values[k])
            .map(([k, v]) => `${k.replace(/_/g,' ')}: ${v}`)
          const noteText = [`[${action.title}]`, ...noteFields, `by: ${user?.email ?? 'admin'}`].join(' · ')
          noteLog.unshift({ text: noteText, ts: new Date().toISOString() })

          // Action-specific DB updates
          const updates: Record<string, unknown> = {
            notes:      JSON.stringify(noteLog),
            updated_at: new Date().toISOString(),
          }

          if (action.id === 'surrender_vehicle') {
            updates.sheet_tab = 'Surrenders'
            updates.online_status = 'Surrendered'
          }

          const { error } = await sb.from('vehicles').update(updates).eq('id', vehicle.id)
          if (error) { setResult({ ok: false, msg: error.message }); setBusy(false); setStep(steps.length - 1); return }

          // Audit log (non-fatal)
          try {
            await sb.from('audit_log').insert({
              user_email: user?.email ?? 'admin',
              action: action.id, target_type: 'vehicle', target_id: vehicle.id,
              vehicle_number: vNum, payload: values, result: { ok: true }, success: true,
            })
          } catch { /* ignore */ }

          setResult({ ok: true, msg: `✓ ${action.title} completed for #${vNum} ${vehicle.fleet_id?.toUpperCase()}. Note added to vehicle record.` })
        } else {
          setResult({ ok: false, msg: 'No valid vehicle number provided.' })
        }
      } catch (err) { setResult({ ok: false, msg: err instanceof Error ? err.message : 'Error' }) }
      setBusy(false); setStep(steps.length - 1); return
    }
    setStep(s => s + 1)
  }

  const canAdvance = cur.type === 'result' || cur.type === 'confirm' || cur.type === 'select' ||
    (cur.key ? !!values[cur.key]?.trim() : true)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{action.icon}</span>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{action.title}</div></div>
          <button className="btn-icon" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div style={{ display: 'flex', padding: '8px 20px 0', gap: 3 }}>
          {steps.slice(0, -1).map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? action.color : 'var(--border)' }} />)}
        </div>
        <div style={{ padding: '12px 20px 20px' }}>
          {cur.type === 'result' ? (
            result && <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`}>{result.msg}</div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{cur.label}</div>
              {cur.type === 'input' && (
                <input autoFocus placeholder={cur.placeholder} value={cur.key ? (values[cur.key] ?? '') : ''}
                  onChange={e => cur.key && setValues(v => ({ ...v, [cur.key!]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && canAdvance && advance()} style={{ width: '100%', marginBottom: 12 }} />
              )}
              {cur.type === 'select' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {cur.options?.map(o => (
                    <button key={o.value} onClick={() => { if (cur.key) { setValues(v => ({ ...v, [cur.key!]: o.value })); setTimeout(advance, 80) } }}
                      style={{ padding: '9px 12px', background: values[cur.key ?? ''] === o.value ? `${action.color}22` : 'var(--bg3)', border: `1px solid ${values[cur.key ?? ''] === o.value ? action.color : 'var(--border)'}`, borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {cur.type === 'confirm' && (
                <div style={{ background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 12 }}>
                  {Object.entries(values).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
                      <span style={{ color: 'var(--text3)', width: 110, flexShrink: 0 }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {step > 0 && cur.type !== 'select' && cur.type !== 'result' && (
              <button className="btn-secondary" onClick={() => setStep(s => s - 1)} disabled={busy}>← Back</button>
            )}
            {cur.type === 'result' ? (
              <button className="btn-primary" onClick={onClose}>Done</button>
            ) : cur.type !== 'select' && (
              <button className="btn-primary" onClick={advance} disabled={!canAdvance || busy}
                style={{ background: action.color, borderColor: action.color }}>
                {busy ? <><span className="spinner" /> Working…</> : cur.type === 'confirm' ? 'Confirm' : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Issue Card ────────────────────────────────────────────── */
function IssueCard({ issue, onUpdate }: { issue: Issue; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [saving,   setSaving]   = useState(false)

  async function addNote() {
    if (!noteText.trim()) return
    setSaving(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const entry = { text: noteText.trim(), ts: new Date().toISOString(), author: user?.email ?? 'admin' }
    const updated = [entry, ...issue.notes_log]
    await sb.from('issues').update({ notes_log: updated, updated_at: new Date().toISOString() }).eq('id', issue.id)
    setNoteText(''); setSaving(false); onUpdate()
  }

  async function resolve() {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('issues').update({ status: 'resolved', resolved_by: user?.email, resolved_at: new Date().toISOString() }).eq('id', issue.id)
    onUpdate()
  }

  const priorityColor = issue.priority === 'high' ? 'var(--red)' : issue.priority === 'low' ? 'var(--text3)' : 'var(--amber)'

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: priorityColor, flexShrink: 0, marginTop: 6 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{issue.title}</div>
          {issue.body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{issue.body}</div>}
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
            Opened {new Date(issue.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {issue.notes_log.length > 0 && ` · ${issue.notes_log.length} note${issue.notes_log.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Hide' : 'Notes'}
          </button>
          <button className="btn-secondary btn-sm" style={{ fontSize: 11, color: 'var(--green)' }} onClick={resolve}>✓ Resolve</button>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {issue.notes_log.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 12 }}>
              <div style={{ color: 'var(--text3)', whiteSpace: 'nowrap', fontSize: 10, paddingTop: 1 }}>
                {new Date(n.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <div>{n.text}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={noteText} onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Add a note…" style={{ flex: 1, fontSize: 12 }} />
            <button className="btn-primary btn-sm" onClick={addNote} disabled={saving || !noteText.trim()}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────── */
export default function ActionsPage() {
  const [active,      setActive]      = useState<QuickAction | null>(null)
  const [issues,      setIssues]      = useState<Issue[]>([])
  const claudeOn = false
  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [addingIssue,   setAddingIssue]  = useState(false)

  useEffect(() => { loadIssues() }, [])

  async function loadIssues() {
    const sb = createClient()
    const { data } = await sb.from('issues').select('*').eq('status', 'open').order('created_at')
    setIssues((data ?? []) as Issue[])
  }

  async function addIssue() {
    if (!newIssueTitle.trim()) return
    setAddingIssue(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('issues').insert({ title: newIssueTitle.trim(), notes_log: [], created_by: user?.email ?? 'admin' })
    setNewIssueTitle(''); setAddingIssue(false); loadIssues()
  }

  function handleAction(action: QuickAction) {
    if (action.toggle) { return }  // Claude Support moved to topbar
    if (action.href)   { window.location.href = action.href; return }
    setActive(action)
  }

  return (
    <div className="page-content">
      {active && <WorkflowModal action={active} onClose={() => { setActive(null); }} />}

      <div className="page-header">
        <div><h1>Quick Actions</h1><p>Guided workflows and fleet management tools</p></div>
      </div>

      {/* Action Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 32 }}>
        {QUICK_ACTIONS.map(action => {
          const isOn = action.id === 'claude_support' ? claudeOn : false
          return (
            <button key={action.id} onClick={() => handleAction(action)}
              style={{ background: isOn ? `${action.color}18` : 'var(--bg2)', border: `1px solid ${isOn ? action.color : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '18px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', display: 'flex', flexDirection: 'column', gap: 8 }}
              onMouseEnter={e => { if (!isOn) { e.currentTarget.style.borderColor = action.color; e.currentTarget.style.background = `${action.color}0d` } }}
              onMouseLeave={e => { if (!isOn) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg2)' } }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `${action.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {action.icon}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: isOn ? action.color : undefined }}>{action.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4, marginTop: 2 }}>{action.description}</div>
              </div>
              {action.toggle && (
                <div style={{ fontSize: 11, fontWeight: 600, color: isOn ? action.color : 'var(--text3)' }}>
                  {isOn ? '● Enabled' : '○ Disabled'}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Open Issues */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Open Issues</h2>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>{issues.length} unresolved · click Resolve to close</p>
        </div>
      </div>

      {/* Add issue */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={newIssueTitle} onChange={e => setNewIssueTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addIssue()}
          placeholder="Add a new issue…" style={{ flex: 1 }} />
        <button className="btn-primary btn-sm" onClick={addIssue} disabled={addingIssue || !newIssueTitle.trim()}>
          {addingIssue ? <span className="spinner" /> : '+ Add'}
        </button>
      </div>

      {issues.length === 0 ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          ✓ No open issues. Run migration 018 to load default issues.
        </div>
      ) : (
        issues.map(i => <IssueCard key={i.id} issue={i} onUpdate={loadIssues} />)
      )}
    </div>
  )
}
