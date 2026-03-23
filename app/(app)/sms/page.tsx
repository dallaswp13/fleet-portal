'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface SmsMessage {
  id: string; received_at: string; sender: string; sms_text: string
  action: string | null; vehicle_number: string | null; vehicle_id: string | null
  target: string | null; confidence: string | null; reason: string | null
  rule_name: string | null; device_name: string | null; result: string | null
  success: boolean | null; created_at: string
}

interface SmsRule {
  id: string; name: string; keywords: string[]; action: string
  reply_text: string | null; enabled: boolean; priority: number; created_by: string
}

const ACTION_OPTIONS = [
  { value: 'reboot_driver',  label: '↺ Reboot Driver Tablet',  group: 'Reboot' },
  { value: 'reboot_pim',     label: '↺ Reboot PIM Tablet',     group: 'Reboot' },
  { value: 'kiosk_enter',    label: '⬛ Enable Kiosk Mode',     group: 'Kiosk'  },
  { value: 'kiosk_exit',     label: '⬜ Exit Kiosk Mode',       group: 'Kiosk'  },
  { value: 'clear_dispatch', label: '🗑 Clear Dispatch App',    group: 'Clear'  },
  { value: 'clear_pim_bt',   label: '🔵 Clear PIM Bluetooth',  group: 'Clear'  },
  { value: 'clear_app_data', label: '🗑 Clear All App Data',    group: 'Clear'  },
  { value: 'support_driver', label: '🛠 Initiate Driver Support',group: 'Support'},
  { value: 'support_pim',    label: '🛠 Initiate PIM Support',  group: 'Support'},
  { value: 'auto_reply',     label: '💬 Auto Reply',            group: 'Other'  },
]

const ACTION_LABELS: Record<string, string> = Object.fromEntries(ACTION_OPTIONS.map(o => [o.value, o.label]))
ACTION_LABELS['unknown'] = '—'


function VehicleSearch({ vehicles, value, onChange }: {
  vehicles: { id: string; vehicle_number: number; fleet_id: string }[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery]   = useState('')
  const [open,  setOpen]    = useState(false)
  const selected = vehicles.find(v => v.id === value)

  const matches = query.length > 0
    ? vehicles.filter(v => String(v.vehicle_number).includes(query) || v.fleet_id.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
    : vehicles.slice(0, 20)

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <input
        placeholder="Type vehicle number…"
        value={open ? query : (selected ? `${selected.vehicle_number} ${selected.fleet_id.toUpperCase()}` : '')}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text3)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
            onMouseDown={() => { onChange(''); setOpen(false); setQuery('') }}>
            — Unassigned —
          </div>
          {matches.map(v => (
            <div key={v.id} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: v.id === value ? 'var(--accent-dim)' : undefined }}
              onMouseDown={() => { onChange(v.id); setOpen(false); setQuery('') }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = v.id === value ? 'var(--accent-dim)' : '')}>
              <strong>{v.vehicle_number}</strong> <span style={{ color: 'var(--text3)' }}>{v.fleet_id.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SmsPage() {
  const router = useRouter()

  // Admin-only page — redirect non-admins immediately
  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/'); return }
      const { data: profile } = await sb.from('user_profiles').select('is_admin').eq('id', user.id).single()
      if (!profile?.is_admin) router.push('/')
    })
  }, [])

  const [messages,    setMessages]    = useState<SmsMessage[]>([])
  const [rules,       setRules]       = useState<SmsRule[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [polling,     setPolling]     = useState(false)
  const [pollMsg,     setPollMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [showRules,   setShowRules]   = useState(false)

  const [showNewRule, setShowNewRule] = useState(false)
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set())

  // Rule form
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [newName,     setNewName]     = useState('')
  const [newKeywords, setNewKeywords] = useState('')
  const [newAction,   setNewAction]   = useState('reboot_driver')
  const [newReply,    setNewReply]    = useState('')
  const [savingRule,  setSavingRule]  = useState(false)
  const [testingRule, setTestingRule] = useState<string | null>(null)
  const [testResult,  setTestResult]  = useState<{ ruleId: string; ok: boolean; text: string } | null>(null)
  const [threadMsg,   setThreadMsg]   = useState<SmsMessage | null>(null)
  const [thread,      setThread]      = useState<SmsMessage[]>([])
  const [vehicles,    setVehicles]    = useState<{ id: string; vehicle_number: number; fleet_id: string }[]>([])
  const [assignVeh,   setAssignVeh]   = useState('')
  const [assigning,   setAssigning]   = useState(false)

  useEffect(() => {
    loadMessages(); loadRules()
    const supabase = createClient()
    supabase.from('vehicles').select('id,vehicle_number,fleet_id').eq('sheet_tab','Active Vehicles').in('fleet_id',['E','L','S','Y','U']).order('vehicle_number').then(({data}) => setVehicles((data ?? []) as {id:string;vehicle_number:number;fleet_id:string}[]))
  }, [])


  async function resetMessageFields() {
    const supabase = createClient()
    const ids = selectedMsgs.size > 0 ? Array.from(selectedMsgs) : messages.map(m => m.id)
    if (!ids.length) return
    setPolling(true)
    await supabase.from('sms_messages').update({
      vehicle_id: null, vehicle_number: null, action: null,
      rule_name: null, confidence: null, result: null, success: null,
      processed: false,
    }).in('id', ids)
    await loadMessages()
    setSelectedMsgs(new Set())
    setPolling(false)
  }

  async function loadMessages() {
    setLoadingMsgs(true)
    const supabase = createClient()
    const { data } = await supabase.from('sms_messages').select('*').order('received_at', { ascending: false }).limit(200)
    setMessages((data ?? []) as SmsMessage[])
    setLoadingMsgs(false)
  }

  async function loadRules() {
    const supabase = createClient()
    const { data } = await supabase.from('sms_rules').select('*').order('priority', { ascending: false })
    setRules((data ?? []) as SmsRule[])
  }

  async function runPoll() {
    setPolling(true); setPollMsg(null)
    try {
      const res  = await fetch('/api/sms/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.success) { setPollMsg({ ok: true, text: `${data.processed} message(s) processed` }); loadMessages() }
      else setPollMsg({ ok: false, text: data.error ?? 'Poll failed' })
    } catch { setPollMsg({ ok: false, text: 'Network error' }) }
    finally { setPolling(false) }
  }

  async function openThread(msg: SmsMessage) {
    setThreadMsg(msg)
    setAssignVeh(msg.vehicle_id ?? '')
    const supabase = createClient()
    const { data } = await supabase.from('sms_messages')
      .select('*').eq('sender', msg.sender)
      .order('received_at', { ascending: false }).limit(50)
    setThread((data ?? []) as SmsMessage[])
  }

  async function assignVehicle() {
    if (!threadMsg) return
    setAssigning(true)
    const supabase = createClient()
    const veh = vehicles.find(v => v.id === assignVeh)
    await supabase.from('sms_messages')
      .update({ vehicle_id: assignVeh || null, vehicle_number: veh ? String(veh.vehicle_number) : null })
      .eq('sender', threadMsg.sender)
    setAssigning(false)
    setThreadMsg(prev => prev ? { ...prev, vehicle_id: assignVeh || null } : null)
    loadMessages()
  }

  async function saveRule() {
    if (!newName.trim() || !newKeywords.trim()) return
    setSavingRule(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const keywords = newKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    const maxPri   = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0

    if (editingId) {
      await supabase.from('sms_rules').update({
        name: newName, keywords, action: newAction,
        reply_text: newAction === 'auto_reply' ? newReply : null,
        updated_at: new Date().toISOString()
      }).eq('id', editingId)
    } else {
      await supabase.from('sms_rules').insert({
        name: newName, keywords, action: newAction,
        reply_text: newAction === 'auto_reply' ? newReply : null,
        priority: maxPri + 1, created_by: user?.email ?? 'admin'
      })
    }
    setSavingRule(false); resetForm(); loadRules()
  }

  function resetForm() {
    setShowNewRule(false); setEditingId(null)
    setNewName(''); setNewKeywords(''); setNewAction('reboot_driver'); setNewReply('')
  }

  function startEdit(r: SmsRule) {
    setEditingId(r.id); setNewName(r.name); setNewKeywords(r.keywords.join(', '))
    setNewAction(r.action); setNewReply(r.reply_text ?? '')
    setShowNewRule(true); setShowRules(true)
  }

  async function toggleRule(id: string, enabled: boolean) {
    const supabase = createClient()
    await supabase.from('sms_rules').update({ enabled: !enabled }).eq('id', id)
    loadRules()
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return
    const supabase = createClient()
    await supabase.from('sms_rules').delete().eq('id', id)
    loadRules()
  }

  async function testRule(rule: SmsRule) {
    const ids = selectedMsgs.size > 0 ? Array.from(selectedMsgs) : messages.slice(0, 10).map(m => m.id)
    if (ids.length === 0) { setTestResult({ ruleId: rule.id, ok: false, text: 'No messages to test on. Poll for messages first.' }); return }
    setTestingRule(rule.id)
    try {
      const res  = await fetch('/api/sms/poll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRuleAction: rule.action, messageIds: ids })
      })
      const data = await res.json()
      if (!data.success) {
        setTestResult({ ruleId: rule.id, ok: false, text: data.error ?? 'API error' })
      } else {
        const results = (data.results ?? []) as { id: string; success: boolean; result: string; detail: string }[]
        const succeeded = results.filter(r => r.success).length
        const details   = results.map(r => `${r.success ? '✓' : '✗'} ${r.detail || r.result}`).join(' | ')
        setTestResult({ ruleId: rule.id, ok: true, text: `${succeeded}/${results.length} succeeded: ${details}` })
      }
      loadMessages()
    } catch (err) {
      setTestResult({ ruleId: rule.id, ok: false, text: `Test failed: ${err instanceof Error ? err.message : 'Network error'}` })
    }
    setTestingRule(null)
  }

  function toggleMsgSelect(id: string) {
    setSelectedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    if (selectedMsgs.size === messages.length) {
      setSelectedMsgs(new Set())
    } else {
      setSelectedMsgs(new Set(messages.map(m => m.id)))
    }
  }

  function confidenceColor(c: string | null) {
    if (c === 'high') return 'badge-green'; if (c === 'medium') return 'badge-amber'; return 'badge-red'
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>SMS Command Center</h1>
          <p>Incoming Google Voice texts — parsed and acted on automatically</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>

<button className="btn-secondary" onClick={() => setShowRules(r => !r)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            ⚙️ Rules ({rules.filter(r => r.enabled).length} active)
          </button>
          <button className="btn-secondary" onClick={resetMessageFields} disabled={polling}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            🔄 Reset {selectedMsgs.size > 0 ? `${selectedMsgs.size} selected` : 'all'}
          </button>
          <button className="btn-primary" onClick={runPoll} disabled={polling}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {polling ? <><span className="spinner" /> Polling…</> : <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg> Poll Now
            </>}
          </button>
        </div>
      </div>

      {pollMsg && <div className={`alert ${pollMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>{pollMsg.text}</div>}

      {/* ── Message Thread Panel ── */}
      {threadMsg && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setThreadMsg(null)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{threadMsg.sender}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{thread.length} messages</div>
              </div>
              <button className="btn-icon" onClick={() => setThreadMsg(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Assign Sender to Vehicle</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <VehicleSearch vehicles={vehicles} value={assignVeh} onChange={setAssignVeh} />
                <button className="btn-primary btn-sm" onClick={assignVehicle} disabled={assigning}>
                  {assigning ? <span className="spinner" /> : 'Assign All'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Assigns all messages from this sender to the selected vehicle</div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px' }}>
              {thread.map(m => (
                <div key={m.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(m.received_at).toLocaleString()}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {m.vehicle_number && <span className="tag" style={{ fontSize: 10 }}>#{m.vehicle_number}</span>}
                      {m.action && m.action !== 'unknown' && <span className="badge badge-blue">{ACTION_LABELS[m.action] ?? m.action}</span>}
                      {m.success === true && <span className="badge badge-green">✓</span>}
                      {m.success === false && <span className="badge badge-red">✗</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', background: 'var(--bg3)', padding: '10px 12px', borderRadius: 'var(--radius)', lineHeight: 1.5 }}>{m.sms_text}</div>
                  {m.result && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{m.result}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Rules Panel ── */}
      {showRules && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Automation Rules</span>
            <button className="btn-secondary btn-sm" onClick={() => setShowRules(false)} style={{ marginLeft: 'auto', marginRight: 8 }}>✕ Collapse</button>
            <button className="btn-primary btn-sm" onClick={() => { resetForm(); setShowNewRule(r => !r) }}>+ New Rule</button>
          </div>

          {showNewRule && (
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Rule' : 'New Rule'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Rule Name</label>
                  <input placeholder="e.g. Reboot Request" value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Keywords (comma-separated)</label>
                  <input placeholder="reboot, restart, frozen" value={newKeywords} onChange={e => setNewKeywords(e.target.value)} />
                  <div className="form-hint">Any keyword match triggers this rule</div>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Action</label>
                  <select value={newAction} onChange={e => setNewAction(e.target.value)}>
                    {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              {newAction === 'auto_reply' && (
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label">Reply Message</label>
                  <input placeholder="e.g. Your request has been received. IT will assist shortly." value={newReply} onChange={e => setNewReply(e.target.value)} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary btn-sm" onClick={saveRule} disabled={savingRule || !newName || !newKeywords}>
                  {savingRule ? <><span className="spinner" /> Saving…</> : editingId ? 'Update Rule' : 'Add Rule'}
                </button>
                <button className="btn-secondary btn-sm" onClick={resetForm}>Cancel</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No rules yet. Run migration 010 to load defaults, or click "+ New Rule".
            </div>
          ) : (
            <>
              {selectedMsgs.size > 0 && (
                <div style={{ padding: '8px 16px', background: 'var(--blue-bg)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--blue)' }}>
                  {selectedMsgs.size} messages selected — click "Test" on any rule to run it against these messages
                </div>
              )}
              <table>
                <thead>
                  <tr><th>Rule</th><th>Keywords</th><th>Action</th><th>Status</th><th style={{ width: 180 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500, fontSize: 13 }}>
                        {r.name}
                        {r.created_by === 'system' && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>default</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {r.keywords.map(k => (
                            <span key={k} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg4)', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{k}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: 11 }}>{ACTION_LABELS[r.action] ?? r.action}</span>
                        {r.reply_text && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>"{r.reply_text.slice(0, 40)}…"</div>}
                      </td>
                      <td>
                        <button onClick={() => toggleRule(r.id, r.enabled)}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 100, cursor: 'pointer', border: 'none',
                            background: r.enabled ? 'var(--green-bg)' : 'var(--bg4)',
                            color: r.enabled ? 'var(--green)' : 'var(--text3)', fontWeight: 600 }}>
                          {r.enabled ? '● Active' : '○ Off'}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          <button className="btn-secondary btn-sm"  onClick={() => startEdit(r)}>Edit</button>
                          <button className="btn-secondary btn-sm" style={{ color: 'var(--blue)' }}
                            onClick={() => testRule(r)} disabled={testingRule === r.id}>
                            {testingRule === r.id ? <span className="spinner" /> : '▶ Test'}
                          </button>
                          <button className="btn-danger btn-sm" style={{ fontSize: 11 }} onClick={() => deleteRule(r.id)}>Del</button>
                        </div>
                        {testResult?.ruleId === r.id && (
                          <div style={{ fontSize: 10, marginTop: 4, color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>{testResult.text}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
            Rules run before Claude — faster and no API cost. Select messages in the log below to test a rule against specific ones.
          </div>
        </div>
      )}

      {/* ── Message Log ── */}
      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Message Log</span>
            {selectedMsgs.size > 0 && (
              <button className="btn-secondary btn-sm"  onClick={() => setSelectedMsgs(new Set())}>
                Clear selection ({selectedMsgs.size})
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{messages.length} messages · click row to view · click ☐ to select for rule testing</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          {loadingMsgs ? (
            <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No messages yet</div>
              <div style={{ fontSize: 12, maxWidth: 400, margin: '0 auto' }}>Configure Gmail credentials in Vercel, then click Poll Now.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <div onClick={toggleSelectAll} title="Select all" style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${selectedMsgs.size === messages.length && messages.length > 0 ? 'var(--blue)' : 'var(--border2)'}`, background: selectedMsgs.size === messages.length && messages.length > 0 ? 'var(--blue)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                      {selectedMsgs.size === messages.length && messages.length > 0 && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
                    </div>
                  </th>
                  <th>Time</th><th>From</th><th>Message</th><th>Vehicle</th>
                  <th>Action</th><th>Rule</th><th>Confidence</th><th>Result</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(m => {
                  const isSelected = selectedMsgs.has(m.id)
                  return (
                    <tr key={m.id} onClick={() => openThread(m)} style={{ cursor: 'pointer', background: isSelected ? 'var(--blue-bg)' : undefined }}>
                      <td onClick={e => { e.stopPropagation(); toggleMsgSelect(m.id) }} style={{ cursor: 'pointer', width: 32 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${isSelected ? 'var(--blue)' : 'var(--border2)'}`,
                          background: isSelected ? 'var(--blue)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                          {isSelected && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
                        </div>
                      </td>
                      <td className="mono text-dim" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(m.received_at).toLocaleString()}</td>
                      <td style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sender}</td>
                      <td style={{ fontSize: 12, maxWidth: 320 }}><div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4, maxHeight: '2.8em' }} title={m.sms_text}>{m.sms_text}</div></td>
                      <td>{m.vehicle_number ? <span className="tag">#{m.vehicle_number}</span> : <span className="text-dim">—</span>}</td>
                      <td><span className="badge badge-gray">{ACTION_LABELS[m.action ?? 'unknown'] ?? m.action ?? '—'}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{m.rule_name ?? <span style={{ opacity: 0.4 }}>Claude</span>}</td>
                      <td>{m.confidence ? <span className={`badge ${confidenceColor(m.confidence)}`}>{m.confidence}</span> : <span className="text-dim">—</span>}</td>
                      <td>
                        {m.success === null ? <span className="badge badge-gray">Skipped</span>
                          : m.success ? <span className="badge badge-green">✓ Done</span>
                          : <span className="badge badge-red" title={m.result ?? ''}>✗ Failed</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
