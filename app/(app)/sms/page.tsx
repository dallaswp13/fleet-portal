'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ASC_FLEETS } from '@/lib/filters'
import { toast } from '@/components/Toaster'

interface SmsMessage {
  id: string
  received_at: string
  sender: string
  sender_phone: string | null
  sms_text: string
  action: string | null
  vehicle_number: string | null
  vehicle_id: string | null
  target: string | null
  confidence: string | null
  reason: string | null
  rule_name: string | null
  device_name: string | null
  result: string | null
  success: boolean | null
  created_at: string
  translated_text: string | null
  source_language: string | null
  direction: 'inbound' | 'outbound'
  recipient_phone: string | null
  claude_status: 'thinking' | 'replied' | 'skipped' | 'failed' | null
  is_claude_reply: boolean | null
  claude_feedback: 'up' | 'down' | null
  claude_feedback_note: string | null
  claude_feedback_at: string | null
  claude_feedback_by: string | null
}

interface SmsRule {
  id: string
  name: string
  keywords: string[]
  action: string              // legacy single-action (mirrors actions[0])
  actions: string[] | null    // multi-action support (migration 031)
  reply_text: string | null
  enabled: boolean
  priority: number
  created_by: string
}

const ACTION_OPTIONS = [
  { value: 'reboot_driver', label: '↺ Reboot Driver Tablet', group: 'Reboot' },
  { value: 'reboot_pim', label: '↺ Reboot PIM Tablet', group: 'Reboot' },
  { value: 'kiosk_enter', label: '⬛ Enable Kiosk Mode', group: 'Kiosk' },
  { value: 'kiosk_exit', label: '⬜ Exit Kiosk Mode', group: 'Kiosk' },
  { value: 'clear_dispatch', label: '🗑 Clear Dispatch App', group: 'Clear' },
  { value: 'clear_pim_bt', label: '🔵 Clear PIM Bluetooth', group: 'Clear' },
  { value: 'clear_app_data', label: '🗑 Clear All App Data', group: 'Clear' },
  { value: 'support_driver', label: '🛠 Initiate Driver Support', group: 'Support' },
  { value: 'support_pim', label: '🛠 Initiate PIM Support', group: 'Support' },
  { value: 'auto_reply', label: '💬 Auto Reply', group: 'Other' },
]

const ACTION_LABELS: Record<string, string> = Object.fromEntries(ACTION_OPTIONS.map(o => [o.value, o.label]))
ACTION_LABELS['unknown'] = '—'

function resolveM360Action(smsAction: string): { m360Action: string; isPim: boolean } {
  switch (smsAction) {
    case 'reboot_driver': return { m360Action: 'reboot', isPim: false }
    case 'reboot_pim': return { m360Action: 'reboot', isPim: true }
    case 'support_driver': return { m360Action: 'support_driver', isPim: false }
    case 'support_pim': return { m360Action: 'support_pim', isPim: true }
    case 'clear_pim_bt': return { m360Action: 'clear_pim_bt', isPim: true }
    case 'kiosk_enter': return { m360Action: 'kiosk_enter', isPim: false }
    case 'kiosk_exit': return { m360Action: 'kiosk_exit', isPim: false }
    case 'clear_dispatch': return { m360Action: 'clear_dispatch', isPim: false }
    case 'clear_app_data': return { m360Action: 'clear_app_data', isPim: false }
    case 'wipe': return { m360Action: 'wipe', isPim: false }
    default: return { m360Action: smsAction, isPim: false }
  }
}

const DESTRUCTIVE_ACTIONS = new Set(['wipe', 'kiosk_enter', 'kiosk_exit'])

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1)
  }
  return cleaned
}

function VehicleSearch({ vehicles, value, onChange }: {
  vehicles: { id: string; vehicle_number: number; fleet_id: string }[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
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

interface Conversation {
  phone: string
  displayName: string | null
  lastMessage: SmsMessage
  messageCount: number
  unprocessedCount: number
}

export default function SmsPage() {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/'); return }
      const { data: profile } = await sb.from('user_profiles').select('is_admin').eq('id', user.id).single()
      if (!profile?.is_admin) router.push('/')
    })
  }, [])

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [rules, setRules] = useState<SmsRule[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pollMsg, setPollMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showNewRule, setShowNewRule] = useState(false)
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [conversationMessages, setConversationMessages] = useState<SmsMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [vehicles, setVehicles] = useState<{ id: string; vehicle_number: number; fleet_id: string }[]>([])
  const [assignVeh, setAssignVeh] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [committingId, setCommittingId] = useState<string | null>(null)
  const [confirmMsg, setConfirmMsg] = useState<SmsMessage | null>(null)
  const [commitResult, setCommitResult] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newKeywords, setNewKeywords] = useState('')
  const [newActions, setNewActions] = useState<string[]>(['reboot_driver'])
  const [newReply, setNewReply] = useState('')
  const [savingRule, setSavingRule] = useState(false)
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set())
  const [twilioConfigured, setTwilioConfigured] = useState(true)
  const [feedbackModal, setFeedbackModal] = useState<{ msg: SmsMessage; rating: 'up' | 'down' } | null>(null)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [savingFeedback, setSavingFeedback] = useState(false)

  useEffect(() => {
    loadMessages()
    loadRules()
    const supabase = createClient()
    supabase.from('vehicles').select('id,vehicle_number,fleet_id').eq('sheet_tab', 'Active Vehicles').in('fleet_id', [...ASC_FLEETS]).order('vehicle_number').then(({ data }) => setVehicles((data ?? []) as { id: string; vehicle_number: number; fleet_id: string }[]))

    // Supabase Realtime: apply INSERT / UPDATE events surgically instead of
    // triggering a full 500-row reload. A full reload happens to work but:
    //   1. It's slow (flicker + wasted bandwidth).
    //   2. It races with loadMessages() from other handlers.
    //   3. If the WebSocket hiccups and drops events, we'd miss updates.
    //
    // New strategy:
    //   - INSERT  → prepend to state if the row isn't already there.
    //   - UPDATE  → patch the matching row in place.
    //   - DELETE  → remove from state.
    //   - On reconnect (SUBSCRIBED event after a drop), do a full reload to
    //     catch anything we missed during the disconnect window.
    //   - Safety net: refresh every 60s in case Realtime is silently broken.
    //
    // Applies the same normalization as loadMessages() so migration-027-less
    // environments still render correctly.
    const OUTBOUND_SENDERS = new Set(['dallas', 'system', 'fleet portal', 'la yellow support'])
    function normalize(m: Record<string, unknown>): SmsMessage {
      const senderLower = (m.sender ?? '').toString().trim().toLowerCase()
      const looksOutbound = OUTBOUND_SENDERS.has(senderLower) || m.action === 'auto_reply' || !!m.recipient_phone
      const direction = (m.direction as string) ?? (looksOutbound ? 'outbound' : 'inbound')
      const recipient_phone = (m.recipient_phone as string | null) ?? (looksOutbound ? (m.sender_phone as string | null) : null)
      return { ...m, direction, recipient_phone } as SmsMessage
    }

    let subscribedOnce = false

    const channel = supabase
      .channel('sms_messages_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, (payload) => {
        const row = normalize(payload.new as Record<string, unknown>)
        setMessages(prev => {
          // Skip if we already have it (e.g. our own sendReply just inserted it
          // via REST and Realtime is telling us about the same row).
          if (prev.some(m => m.id === row.id)) return prev
          return [row, ...prev].slice(0, 500)
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sms_messages' }, (payload) => {
        const updated = normalize(payload.new as Record<string, unknown>)
        setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sms_messages' }, (payload) => {
        const oldId = (payload.old as { id?: string })?.id
        if (!oldId) return
        setMessages(prev => prev.filter(m => m.id !== oldId))
      })
      .subscribe((status) => {
        // On (re)connect, fetch the full list once so we don't miss any
        // events that fired while the socket was down.
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) loadMessages({ silent: true })
          subscribedOnce = true
        }
      })

    // Safety net: if Realtime silently stops delivering events (network
    // partition, auth expiry, Supabase hiccup), a minute-cadence refresh
    // guarantees inbox freshness without user intervention.
    const pollInterval = window.setInterval(() => {
      loadMessages({ silent: true })
    }, 60_000)

    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(pollInterval)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationMessages])

  // Refresh conversation view when messages state updates
  useEffect(() => {
    if (selectedConversation) {
      const convMessages = messages.filter(m => {
        const msgPhone = m.direction === 'inbound' ? normalizePhone(m.sender_phone) : normalizePhone(m.recipient_phone)
        return msgPhone === selectedConversation
      }).sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
      setConversationMessages(convMessages)
    }
  }, [messages, selectedConversation])

  async function loadMessages(opts: { silent?: boolean } = {}) {
    // Silent reloads don't set loadingMsgs → used for Realtime catch-up and
    // the 60s safety poll, so the inbox doesn't flash a spinner every minute.
    if (!opts.silent) setLoadingMsgs(true)
    const supabase = createClient()
    const { data } = await supabase.from('sms_messages').select('*').order('received_at', { ascending: false }).limit(500)
    // Normalize: if migration 027 hasn't run, direction/recipient_phone may be missing.
    // Heuristics: messages sent BY us (Dallas / System / Fleet Portal) are outbound;
    // auto_reply actions are outbound; everything else is inbound.
    const OUTBOUND_SENDERS = new Set(['dallas', 'system', 'fleet portal', 'la yellow support'])
    const normalized = (data ?? []).map(m => {
      const senderLower = (m.sender ?? '').toString().trim().toLowerCase()
      const looksOutbound = OUTBOUND_SENDERS.has(senderLower) || m.action === 'auto_reply' || !!m.recipient_phone
      const direction = m.direction ?? (looksOutbound ? 'outbound' : 'inbound')
      const recipient_phone = m.recipient_phone ?? (looksOutbound ? m.sender_phone : null)
      return { ...m, direction, recipient_phone }
    }) as SmsMessage[]
    setMessages(normalized)
    if (!opts.silent) setLoadingMsgs(false)
  }

  async function loadRules() {
    const supabase = createClient()
    const { data } = await supabase.from('sms_rules').select('*').order('priority', { ascending: false })
    const normalized = (data ?? []).map(r => ({
      ...r,
      actions: (r as { actions?: string[] | null }).actions ?? (r.action ? [r.action] : []),
    })) as SmsRule[]
    setRules(normalized)
  }

  async function refresh() {
    setRefreshing(true)
    setPollMsg(null)
    try {
      await loadMessages()
      await loadRules()
    } finally {
      setRefreshing(false)
    }
  }

  function getConversations(): Conversation[] {
    const conversationMap = new Map<string, { messages: SmsMessage[]; displayName: string | null }>()

    for (const msg of messages) {
      const phone = msg.direction === 'inbound' ? normalizePhone(msg.sender_phone) : normalizePhone(msg.recipient_phone)
      if (!phone) continue

      if (!conversationMap.has(phone)) {
        conversationMap.set(phone, { messages: [], displayName: null })
      }
      conversationMap.get(phone)!.messages.push(msg)
    }

    const OUTBOUND_SENDER_LABELS = new Set(['system', 'fleet portal', 'la yellow support', 'dallas'])
    const conversations: Conversation[] = Array.from(conversationMap.entries()).map(([phone, data]) => {
      const lastMessage = data.messages[0]
      const unprocessedCount = data.messages.filter(m => m.success === null && m.action).length
      // Pick the most recent INBOUND message's sender as the contact label.
      // Outbound messages have sender='System'/'Fleet Portal' which would
      // mislabel the contact thread.
      const inboundSender = data.messages
        .find(m => m.direction === 'inbound' && m.sender && !OUTBOUND_SENDER_LABELS.has(m.sender.toLowerCase().trim()))
        ?.sender ?? null
      return {
        phone,
        displayName: inboundSender,
        lastMessage,
        messageCount: data.messages.length,
        unprocessedCount,
      }
    })

    return conversations.sort((a, b) => new Date(b.lastMessage.received_at).getTime() - new Date(a.lastMessage.received_at).getTime())
  }

  function loadConversation(phone: string) {
    setSelectedConversation(phone)
    const convMessages = messages.filter(m => {
      const msgPhone = m.direction === 'inbound' ? normalizePhone(m.sender_phone) : normalizePhone(m.recipient_phone)
      return msgPhone === phone
    }).sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
    setConversationMessages(convMessages)
    setReplyText('')
    setAssignVeh(convMessages[0]?.vehicle_id ?? '')
  }

  async function sendReply() {
    if (!selectedConversation || !replyText.trim()) return
    setSendingReply(true)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedConversation, body: replyText.trim() })
      })
      const data = await res.json()
      if (data.success) {
        setReplyText('')
        await loadMessages() // useEffect will refresh conversationMessages
      } else {
        setPollMsg({ ok: false, text: data.error ?? 'Failed to send' })
      }
    } catch (err) {
      setPollMsg({ ok: false, text: 'Network error' })
    } finally {
      setSendingReply(false)
    }
  }

  async function submitFeedback(msg: SmsMessage, rating: 'up' | 'down' | null, note: string) {
    setSavingFeedback(true)
    try {
      const res = await fetch('/api/sms/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msg.id, rating, note: note.trim() || undefined }),
      })
      const data = await res.json()
      if (!data.ok) {
        setPollMsg({ ok: false, text: data.error ?? 'Failed to save feedback' })
      }
      setFeedbackModal(null)
      setFeedbackNote('')
      loadMessages()
    } catch {
      setPollMsg({ ok: false, text: 'Network error' })
    } finally {
      setSavingFeedback(false)
    }
  }

  async function quickFeedback(msg: SmsMessage, rating: 'up' | 'down') {
    // Thumbs up is one-click. Thumbs down opens the modal for a note.
    if (rating === 'down') {
      setFeedbackNote(msg.claude_feedback_note ?? '')
      setFeedbackModal({ msg, rating })
      return
    }
    await submitFeedback(msg, rating, '')
  }

  async function assignVehicle() {
    if (!selectedConversation) return
    setAssigning(true)
    const supabase = createClient()
    const veh = vehicles.find(v => v.id === assignVeh)
    await supabase.from('sms_messages')
      .update({ vehicle_id: assignVeh || null, vehicle_number: veh ? String(veh.vehicle_number) : null })
      .filter('sender_phone', 'eq', selectedConversation)
    setAssigning(false)
    loadMessages()
  }

  async function commitAction(msg: SmsMessage, confirmed = false) {
    if (!msg.action || msg.action === 'unknown' || msg.action === 'auto_reply') return
    if (!msg.vehicle_number) {
      setCommitResult({ id: msg.id, ok: false, text: 'No vehicle assigned' })
      return
    }

    const { m360Action, isPim } = resolveM360Action(msg.action)
    const needsConfirm = DESTRUCTIVE_ACTIONS.has(m360Action) || msg.confidence === 'low'
    if (needsConfirm && !confirmed) {
      setConfirmMsg(msg)
      return
    }

    setCommittingId(msg.id)
    setCommitResult(null)
    const supabase = createClient()

    try {
      const { data: veh } = await supabase
        .from('fleet_overview')
        .select('vehicle_id,vehicle_number,fleet_id,m360_device_id,pim_m360_device_id')
        .eq('vehicle_number', parseInt(msg.vehicle_number))
        .limit(1)
        .single()

      if (!veh) {
        throw new Error(`Vehicle #${msg.vehicle_number} not found in fleet`)
      }

      const deviceId = isPim ? veh.pim_m360_device_id : veh.m360_device_id
      if (!deviceId) {
        throw new Error(`No ${isPim ? 'PIM' : 'driver'} device linked to vehicle #${msg.vehicle_number}`)
      }

      const res = await fetch('/api/maas360/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: m360Action,
          deviceId,
          vehicleNumber: veh.vehicle_number,
          confirmed: DESTRUCTIVE_ACTIONS.has(m360Action),
        }),
      })
      const data = await res.json()

      await supabase.from('sms_messages').update({
        success: data.success ?? false,
        result: data.message ?? data.error ?? 'Unknown',
      }).eq('id', msg.id)

      setCommitResult({ id: msg.id, ok: data.success, text: data.message ?? data.error })
      const toastLabel = `Vehicle ${veh.vehicle_number} · ${m360Action}`
      if (data.success) toast.success(`${toastLabel} sent`, { detail: data.message ?? 'M360 accepted the request' })
      else              toast.error(`${toastLabel} failed`, { detail: data.error ?? data.message ?? `HTTP ${res.status}` })
      loadMessages()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('sms_messages').update({ success: false, result: errMsg }).eq('id', msg.id)
      setCommitResult({ id: msg.id, ok: false, text: errMsg })
      toast.error(`${m360Action} failed`, { detail: errMsg })
      loadMessages()
    } finally {
      setCommittingId(null)
    }
  }

  async function saveRule() {
    if (!newName.trim() || !newKeywords.trim()) return
    setSavingRule(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const keywords = newKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    const maxPri = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0

    const actionsToSave = newActions.length > 0 ? newActions : ['unknown']
    const includesAutoReply = actionsToSave.includes('auto_reply')
    const basePayload = {
      name: newName,
      keywords,
      action: actionsToSave[0],
      actions: actionsToSave,
      reply_text: includesAutoReply ? newReply : null,
    }

    // Try with `actions` column; fall back to legacy payload if migration 031
    // hasn't been applied yet.
    if (editingId) {
      let { error } = await supabase.from('sms_rules').update({
        ...basePayload,
        updated_at: new Date().toISOString(),
      }).eq('id', editingId)
      if (error && /column .*actions.* does not exist/i.test(error.message)) {
        const { actions: _a, ...legacy } = basePayload
        await supabase.from('sms_rules').update({
          ...legacy,
          updated_at: new Date().toISOString(),
        }).eq('id', editingId)
      }
    } else {
      let { error } = await supabase.from('sms_rules').insert({
        ...basePayload,
        priority: maxPri + 1,
        created_by: user?.email ?? 'admin',
      })
      if (error && /column .*actions.* does not exist/i.test(error.message)) {
        const { actions: _a, ...legacy } = basePayload
        await supabase.from('sms_rules').insert({
          ...legacy,
          priority: maxPri + 1,
          created_by: user?.email ?? 'admin',
        })
      }
    }
    setSavingRule(false)
    resetForm()
    loadRules()
  }

  function resetForm() {
    setShowNewRule(false)
    setEditingId(null)
    setNewName('')
    setNewKeywords('')
    setNewActions(['reboot_driver'])
    setNewReply('')
  }

  function startEdit(r: SmsRule) {
    setEditingId(r.id)
    setNewName(r.name)
    setNewKeywords(r.keywords.join(', '))
    setNewActions(r.actions && r.actions.length > 0 ? r.actions : [r.action])
    setNewReply(r.reply_text ?? '')
    setShowNewRule(true)
    setShowRules(true)
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

  function toggleMsgSelect(id: string) {
    setSelectedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function confidenceColor(c: string | null) {
    if (c === 'high') return 'badge-green'
    if (c === 'medium') return 'badge-amber'
    return 'badge-red'
  }

  async function resetMessageFields() {
    const supabase = createClient()
    const ids = selectedMsgs.size > 0 ? Array.from(selectedMsgs) : messages.map(m => m.id)
    if (!ids.length) return
    setRefreshing(true)
    await supabase.from('sms_messages').update({
      vehicle_id: null,
      vehicle_number: null,
      action: null,
      rule_name: null,
      confidence: null,
      result: null,
      success: null,
      processed: false,
    }).in('id', ids)
    await loadMessages()
    setSelectedMsgs(new Set())
    setRefreshing(false)
  }

  const conversations = getConversations()
  const filteredConversations = conversations.filter(c => {
    if (!searchQuery) return true
    const lower = searchQuery.toLowerCase()
    return (c.phone.includes(lower) || (c.displayName?.toLowerCase().includes(lower)))
  })

  const selectedConv = conversations.find(c => c.phone === selectedConversation)

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* LEFT SIDEBAR */}
      <div style={{ width: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg2)' }}>
        {/* Header with buttons */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-secondary btn-sm" onClick={() => setShowRules(r => !r)} style={{ flex: 1, fontSize: 11 }}>
              ⚙️ Rules
            </button>
            <button className="btn-primary btn-sm" onClick={refresh} disabled={refreshing} style={{ flex: 1, fontSize: 11 }}>
              {refreshing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Refreshing</> : <>↻ Refresh</>}
            </button>
          </div>
          <input
            type="text"
            placeholder="Search conversations…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg3)' }}
          />
        </div>

        {pollMsg && (
          <div style={{ padding: '8px 12px', fontSize: 11, background: pollMsg.ok ? 'var(--green-bg)' : 'var(--red-bg)', color: pollMsg.ok ? 'var(--green)' : 'var(--red)', borderBottom: '1px solid var(--border)' }}>
            {pollMsg.text}
          </div>
        )}

        {/* Conversations List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingMsgs ? (
            <div style={{ padding: '4px 0' }}>
              {[0,1,2,3,4,5].map(i => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <span className="skeleton skeleton-avatar" style={{ width: 36, height: 36 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="skeleton skeleton-text" style={{ width: '50%' }} />
                    <span className="skeleton skeleton-text-sm" style={{ width: '80%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
              No conversations yet
            </div>
          ) : (
            filteredConversations.map(conv => (
              <div
                key={conv.phone}
                onClick={() => loadConversation(conv.phone)}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selectedConversation === conv.phone ? 'var(--bg3)' : 'transparent',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = selectedConversation === conv.phone ? 'var(--bg3)' : 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = selectedConversation === conv.phone ? 'var(--bg3)' : 'transparent')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>
                    {conv.displayName || conv.phone}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                    {new Date(conv.lastMessage.received_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                  {conv.lastMessage.translated_text || conv.lastMessage.sms_text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{conv.messageCount} messages</span>
                  {/* Red unread badges intentionally removed per user request —
                      they created noise and were never actually tied to a
                      read/unread state, just an "unprocessed action" counter
                      that rarely matched what Dallas was looking at. */}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        {selectedConversation && selectedConv ? (
          <>
            {/* Conversation Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
              <div style={{ marginBottom: 12 }}>
                <h2 style={{ margin: '0 0 4px 0', fontSize: 16 }}>
                  {selectedConv.displayName || selectedConv.phone}
                </h2>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {selectedConv.phone} · {selectedConv.messageCount} messages
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Assign to vehicle:</label>
                <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                  <VehicleSearch vehicles={vehicles} value={assignVeh} onChange={setAssignVeh} />
                  <button className="btn-primary btn-sm" onClick={assignVehicle} disabled={assigning}>
                    {assigning ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Assign'}
                  </button>
                </div>
              </div>
            </div>

            {/* Message Thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {conversationMessages.map(msg => {
                const isOutbound = msg.direction === 'outbound'
                const isClaudeReply = isOutbound && (msg.is_claude_reply === true || msg.action === 'claude_reply')
                const isAutoReply = isOutbound && msg.action === 'auto_reply' && !isClaudeReply
                // Outbound from Dallas: blue, auto-reply: teal/green, Claude: purple/violet, inbound: distinct card
                const bubbleBg = isClaudeReply
                  ? 'linear-gradient(135deg, #7c3aed, #a855f7)'
                  : isAutoReply
                    ? 'linear-gradient(135deg, #0d9488, #14b8a6)'
                    : isOutbound
                      ? 'var(--accent)'
                      : 'var(--bg2)'
                const bubbleColor = isOutbound ? 'white' : 'var(--text)'
                const bubbleBorder = isOutbound ? 'none' : '1px solid var(--border)'
                const bubbleShadow = isOutbound ? 'none' : '0 1px 3px rgba(0,0,0,0.08)'

                return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isOutbound ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                  {/* Sender label for inbound messages */}
                  {!isOutbound && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', marginBottom: 2, marginLeft: 4 }}>
                      {msg.sender || 'Unknown'}
                    </div>
                  )}
                  {isAutoReply && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#14b8a6', marginBottom: 2, marginRight: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11 }}>⚡</span> Auto-Reply
                    </div>
                  )}
                  {isClaudeReply && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#a855f7', marginBottom: 2, marginRight: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11 }}>🤖</span> Claude
                    </div>
                  )}
                  {isOutbound && !isAutoReply && !isClaudeReply && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', marginBottom: 2, marginRight: 4 }}>
                      {msg.sender || 'You'}
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '12px',
                      borderRadius: isOutbound ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: bubbleBg,
                      color: bubbleColor,
                      border: bubbleBorder,
                      boxShadow: bubbleShadow,
                      wordWrap: 'break-word',
                      lineHeight: 1.5
                    }}
                  >
                    {msg.translated_text ? (
                      <>
                        <div>{msg.translated_text}</div>
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, fontStyle: 'italic', borderTop: `1px solid ${msg.direction === 'outbound' ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`, paddingTop: 4 }}>
                          {msg.source_language}: {msg.sms_text}
                        </div>
                      </>
                    ) : (
                      msg.sms_text
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>{new Date(msg.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.source_language && <span className="badge badge-blue" style={{ fontSize: 9 }}>🌐 {msg.source_language}</span>}
                    {msg.direction === 'inbound' && msg.action && msg.action !== 'unknown' && (
                      <span className="badge badge-blue" style={{ fontSize: 9 }}>{ACTION_LABELS[msg.action] ?? msg.action}</span>
                    )}
                    {msg.direction === 'inbound' && msg.confidence && (
                      <span className={`badge ${confidenceColor(msg.confidence)}`} style={{ fontSize: 9 }}>{msg.confidence}</span>
                    )}
                    {msg.success === true && <span className="badge badge-green" style={{ fontSize: 9 }}>✓</span>}
                    {msg.success === false && <span className="badge badge-red" style={{ fontSize: 9 }}>✗</span>}
                  </div>
                  {msg.result && msg.direction === 'inbound' && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                      {msg.result}
                    </div>
                  )}
                  {/* Claude feedback buttons — shown only on Claude's outbound replies */}
                  {isClaudeReply && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, marginRight: 4 }}>
                      <button
                        onClick={() => quickFeedback(msg, 'up')}
                        title="Claude handled this well"
                        style={{
                          border: '1px solid var(--border)',
                          background: msg.claude_feedback === 'up' ? 'rgba(34, 197, 94, 0.15)' : 'var(--bg2)',
                          color: msg.claude_feedback === 'up' ? '#16a34a' : 'var(--text3)',
                          borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                          fontWeight: msg.claude_feedback === 'up' ? 700 : 500,
                        }}>
                        👍
                      </button>
                      <button
                        onClick={() => quickFeedback(msg, 'down')}
                        title="Claude got this wrong — leave a correction"
                        style={{
                          border: '1px solid var(--border)',
                          background: msg.claude_feedback === 'down' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg2)',
                          color: msg.claude_feedback === 'down' ? '#dc2626' : 'var(--text3)',
                          borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                          fontWeight: msg.claude_feedback === 'down' ? 700 : 500,
                        }}>
                        👎
                      </button>
                      {msg.claude_feedback === 'down' && msg.claude_feedback_note && (
                        <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={msg.claude_feedback_note}>
                          Correction: &ldquo;{msg.claude_feedback_note}&rdquo;
                        </span>
                      )}
                      {msg.claude_feedback && (
                        <button
                          onClick={() => submitFeedback(msg, null, '')}
                          title="Clear feedback"
                          style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}>
                          clear
                        </button>
                      )}
                    </div>
                  )}
                  {msg.action && msg.action !== 'unknown' && msg.action !== 'auto_reply' && msg.vehicle_number && msg.success === null && msg.direction === 'inbound' && (
                    <div style={{ marginTop: 8 }}>
                      {committingId === msg.id ? (
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                      ) : (
                        <button
                          className="btn-sm"
                          style={{
                            fontSize: 10, padding: '4px 10px',
                            background: '#facc15',
                            color: '#000',
                            border: '1px solid #eab308',
                            borderRadius: 6,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                          onClick={() => commitAction(msg)}>
                          ⚡ Execute {ACTION_LABELS[msg.action] ?? msg.action}
                        </button>
                      )}
                      {commitResult?.id === msg.id && (
                        <div style={{ fontSize: 10, marginTop: 4, color: commitResult.ok ? 'var(--green)' : 'var(--red)' }}>
                          {commitResult.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )
              })}
              {/* Claude thinking indicator — shown when the latest inbound row
                  has claude_status='thinking' and no Claude reply has posted yet. */}
              {(() => {
                const last = conversationMessages[conversationMessages.length - 1]
                if (!last || last.direction !== 'inbound') return null
                if (last.claude_status !== 'thinking') return null
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 16, background: 'rgba(168, 85, 247, 0.08)', border: '1px dashed rgba(168, 85, 247, 0.35)', alignSelf: 'flex-start', maxWidth: '70%', marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>🤖</span>
                    <span className="spinner" style={{ width: 12, height: 12, borderColor: '#a855f7 transparent transparent transparent' }} />
                    <span style={{ fontSize: 12, color: '#a855f7', fontWeight: 600 }}>Claude is thinking…</span>
                  </div>
                )
              })()}
              {/* Claude failure indicator */}
              {(() => {
                const last = conversationMessages[conversationMessages.length - 1]
                if (!last || last.direction !== 'inbound') return null
                if (last.claude_status !== 'failed') return null
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 16, background: 'var(--amber-bg)', alignSelf: 'flex-start', maxWidth: '70%', marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>⚠️</span>
                    <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>
                      Claude couldn&rsquo;t reply automatically — a human should respond.
                    </span>
                  </div>
                )
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Composer */}
            <div style={{ padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
              {!twilioConfigured && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--amber-bg)', color: 'var(--amber)', borderRadius: 'var(--radius)', fontSize: 11 }}>
                  SMS sending not configured. Contact administrator.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Type a reply…"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendReply()
                    }
                  }}
                  disabled={sendingReply || !twilioConfigured}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
                <button className="btn-primary" onClick={sendReply} disabled={sendingReply || !replyText.trim() || !twilioConfigured}>
                  {sendingReply ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Send</> : 'Send'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 13 }}>Select a conversation to start messaging</div>
            </div>
          </div>
        )}
      </div>

      {/* RULES MODAL */}
      {showRules && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowRules(false)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Automation Rules</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary btn-sm" onClick={() => { resetForm(); setShowNewRule(r => !r) }}>
                  + New Rule
                </button>
                <button className="btn-icon" onClick={() => setShowRules(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>

            {showNewRule && (
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Rule' : 'New Rule'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Rule Name</label>
                    <input placeholder="e.g. Reboot Request" value={newName} onChange={e => setNewName(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Keywords (comma-separated)</label>
                    <input placeholder="reboot, restart, frozen" value={newKeywords} onChange={e => setNewKeywords(e.target.value)} />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label">Actions (select one or more)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
                    {ACTION_OPTIONS.map(o => {
                      const checked = newActions.includes(o.value)
                      return (
                        <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, padding: '4px 6px', borderRadius: 4, background: checked ? 'var(--blue-bg)' : 'transparent' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              setNewActions(prev => e.target.checked
                                ? [...prev, o.value]
                                : prev.filter(a => a !== o.value))
                            }}
                          />
                          <span>{o.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                {newActions.includes('auto_reply') && (
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">Reply Message</label>
                    <input placeholder="e.g. Your request has been received. IT will assist shortly." value={newReply} onChange={e => setNewReply(e.target.value)} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" onClick={saveRule} disabled={savingRule || !newName || !newKeywords}>
                    {savingRule ? <><span className="spinner" /> Saving…</> : editingId ? 'Update Rule' : 'Add Rule'}
                  </button>
                  <button className="btn-secondary btn-sm" onClick={resetForm}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rules.length === 0 ? (
                <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  No rules yet. Run migration 010 to load defaults, or click "+ New Rule".
                </div>
              ) : (
                <>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>Rule</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>Keywords</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>Action</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border)', background: 'var(--bg)', width: 180 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>
                            {r.name}
                            {r.created_by === 'system' && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>default</span>}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                              {r.keywords.map(k => (
                                <span key={k} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{k}</span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {(r.actions && r.actions.length > 0 ? r.actions : [r.action]).map(a => (
                                <span key={a} className="badge badge-blue" style={{ fontSize: 11 }}>{ACTION_LABELS[a] ?? a}</span>
                              ))}
                            </div>
                            {r.reply_text && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>&quot;{r.reply_text.slice(0, 40)}…&quot;</div>}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <button onClick={() => toggleRule(r.id, r.enabled)}
                              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 100, cursor: 'pointer', border: 'none', background: r.enabled ? 'var(--green-bg)' : 'var(--bg3)', color: r.enabled ? 'var(--green)' : 'var(--text3)', fontWeight: 600 }}>
                              {r.enabled ? '● Active' : '○ Off'}
                            </button>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <button className="btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>
                              <button className="btn-danger btn-sm" style={{ fontSize: 11 }} onClick={() => deleteRule(r.id)}>Del</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)' }}>
              Rules run before Claude. If any keyword rule matches, Claude does NOT reply — the admin handles via Execute. If no rule matches, Claude generates a conversational reply in the driver&rsquo;s language and learns from your thumbs-down corrections.
            </div>
          </div>
        </div>
      )}

      {/* CLAUDE FEEDBACK MODAL (thumbs down) */}
      {feedbackModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setFeedbackModal(null)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 500, boxShadow: 'var(--shadow-lg)', padding: '24px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>👎</span> Correct Claude&rsquo;s reply
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
              Explain what Claude got wrong. Your note is saved and fed into future Claude prompts as a &ldquo;lesson learned&rdquo; so this mistake isn&rsquo;t repeated.
            </div>
            <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: 12, marginBottom: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
              &ldquo;{feedbackModal.msg.sms_text}&rdquo;
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">What should Claude have done differently?</label>
              <textarea
                placeholder="e.g. &quot;The driver was asking about PIM, not driver tablet. Don't confuse the two.&quot;"
                value={feedbackNote}
                onChange={e => setFeedbackNote(e.target.value)}
                rows={4}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary btn-sm" onClick={() => { setFeedbackModal(null); setFeedbackNote('') }} disabled={savingFeedback}>
                Cancel
              </button>
              <button className="btn-primary btn-sm" onClick={() => submitFeedback(feedbackModal.msg, 'down', feedbackNote)} disabled={savingFeedback || !feedbackNote.trim()}>
                {savingFeedback ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM ACTION MODAL */}
      {confirmMsg && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setConfirmMsg(null)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-lg)', padding: '24px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              {DESTRUCTIVE_ACTIONS.has(resolveM360Action(confirmMsg.action!).m360Action) ? '⚠️ Destructive Action' : '⚠️ Low Confidence — Confirm Action'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
              Execute <strong>{ACTION_LABELS[confirmMsg.action!] ?? confirmMsg.action}</strong> on vehicle <strong>#{confirmMsg.vehicle_number}</strong>?
              {confirmMsg.confidence === 'low' && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--amber-bg)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--amber)' }}>
                  Confidence is <strong>low</strong> — the parsed action may not match the sender's intent. Please review the message before committing.
                </div>
              )}
              {confirmMsg.sms_text && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: 12, fontStyle: 'italic' }}>
                  "{confirmMsg.sms_text}"
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary btn-sm" onClick={() => setConfirmMsg(null)}>Cancel</button>
              <button className={DESTRUCTIVE_ACTIONS.has(resolveM360Action(confirmMsg.action!).m360Action) ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
                onClick={() => { const m = confirmMsg; setConfirmMsg(null); commitAction(m, true) }}>
                {DESTRUCTIVE_ACTIONS.has(resolveM360Action(confirmMsg.action!).m360Action) ? 'Yes, Execute' : 'Confirm & Execute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
