'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { OFFICES, OFFICE_COLORS, type Office } from '@/lib/filters'

interface UserProfile {
  id: string; email: string; display_name: string | null
  is_admin: boolean; offices: Office[] | null; created_at: string
}

export default function UserManager({ currentUserEmail }: { currentUserEmail: string }) {
  const [profiles,  setProfiles]  = useState<UserProfile[]>([])
  const [loading,   setLoading]   = useState(true)
  const [newEmail,  setNewEmail]  = useState('')
  const [newAdmin,  setNewAdmin]  = useState(false)
  const [newOffices,setNewOffices]= useState<Office[]>([...OFFICES])
  const [inviting,  setInviting]  = useState(false)
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [saving,    setSaving]    = useState<string | null>(null)

  useEffect(() => { loadProfiles() }, [])

  async function loadProfiles() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase.from('user_profiles').select('*').order('created_at')
    setProfiles((data ?? []) as UserProfile[])
    setLoading(false)
  }

  function toggleNewOffice(o: Office) {
    setNewOffices(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o])
  }

  async function inviteUser() {
    if (!newEmail.trim()) return
    setInviting(true); setMsg(null)
    try {
      const res  = await fetch('/api/admin/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     newEmail.trim(),
          is_admin:  newAdmin,
          offices:   newOffices.length === OFFICES.length ? null : newOffices,
        })
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ ok: true, text: `Invite sent to ${newEmail}` })
        setNewEmail(''); setNewAdmin(false); setNewOffices([...OFFICES])
        loadProfiles()
      } else {
        setMsg({ ok: false, text: data.error ?? 'Failed to invite user' })
      }
    } catch { setMsg({ ok: false, text: 'Network error' }) }
    setInviting(false)
  }

  async function saveProfile(id: string, updates: { display_name: string | null; is_admin: boolean; offices: Office[] | null }) {
    setSaving(id)
    const supabase = createClient()
    await supabase.from('user_profiles').update({
      display_name: updates.display_name,
      is_admin:     updates.is_admin,
      offices:      updates.offices,
      updated_at:   new Date().toISOString(),
    }).eq('id', id)
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
    setSaving(null)
  }

  const selfProfile = profiles.find(p => p.email === currentUserEmail)
  if (!selfProfile) return (
    <div className="card" style={{ padding: 24 }}>
      <div className="alert alert-warning" style={{ marginBottom: 12 }}>
        You are not in the user_profiles table yet. Run this SQL in Supabase:
      </div>
      <code style={{ fontSize: 12, display: 'block', padding: 12, background: 'var(--bg3)', borderRadius: 6 }}>
        insert into user_profiles (id, email, is_admin) select id, email, true from auth.users where email = &apos;{currentUserEmail}&apos;;
      </code>
    </div>
  )

  return (
    <div>
      {/* Invite form */}
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Invite New User</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 12 }}>
          <input type="email" placeholder="user@company.com" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && inviteUser()} />
          <button className="btn-primary btn-sm" onClick={inviteUser} disabled={inviting || !newEmail.trim()} style={{ whiteSpace: 'nowrap' }}>
            {inviting ? <><span className="spinner" /> Sending…</> : 'Send Invite'}
          </button>
        </div>

        {/* Permissions at invite time */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Role</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setNewAdmin(false)}
                style={{ height: 24, padding: '0 10px', fontSize: 11, borderRadius: 100, cursor: 'pointer', border: '1px solid', fontWeight: !newAdmin ? 600 : 400,
                  background: !newAdmin ? 'var(--bg4)' : 'transparent', color: !newAdmin ? 'var(--text)' : 'var(--text3)', borderColor: !newAdmin ? 'var(--border2)' : 'var(--border)' }}>
                User
              </button>
              <button onClick={() => setNewAdmin(true)}
                style={{ height: 24, padding: '0 10px', fontSize: 11, borderRadius: 100, cursor: 'pointer', border: '1px solid', fontWeight: newAdmin ? 600 : 400,
                  background: newAdmin ? 'var(--amber)' : 'transparent', color: newAdmin ? '#fff' : 'var(--text3)', borderColor: newAdmin ? 'var(--amber)' : 'var(--border)' }}>
                Admin
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Office Access {newOffices.length === OFFICES.length ? '(All)' : `(${newOffices.length} of ${OFFICES.length})`}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setNewOffices([...OFFICES])}
                style={{ height: 24, padding: '0 8px', fontSize: 10, borderRadius: 100, cursor: 'pointer', border: '1px solid var(--border)', background: newOffices.length === OFFICES.length ? 'var(--bg4)' : 'transparent', color: 'var(--text3)' }}>
                All
              </button>
              {OFFICES.map(o => {
                const active = newOffices.includes(o)
                return (
                  <button key={o} onClick={() => toggleNewOffice(o)}
                    style={{ height: 24, padding: '0 8px', fontSize: 10, borderRadius: 100, cursor: 'pointer', border: '1px solid', fontWeight: active ? 600 : 400,
                      background: active ? OFFICE_COLORS[o] : 'transparent', color: active ? '#fff' : 'var(--text3)', borderColor: active ? OFFICE_COLORS[o] : 'var(--border)' }}>
                    {o}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 12 }}>{msg.text}</div>}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
          User receives a magic-link email. Permissions apply immediately.
        </div>
      </div>

      {/* User list */}
      {loading ? <div style={{ padding: 32, textAlign: 'center' }}><span className="spinner" /></div> : (
        <div className="card">
          <table>
            <thead>
              <tr><th>User</th><th>Role</th><th>Office Access</th><th style={{ width: 80 }}>Actions</th></tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <UserRow key={p.id} profile={p} isSelf={p.email === currentUserEmail}
                  saving={saving === p.id} onSave={u => saveProfile(p.id, u)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UserRow({ profile: p, isSelf, saving, onSave }: {
  profile: UserProfile; isSelf: boolean; saving: boolean
  onSave: (u: { display_name: string | null; is_admin: boolean; offices: Office[] | null }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name,    setName]    = useState(p.display_name ?? '')
  const [admin,   setAdmin]   = useState(p.is_admin)
  const [offices, setOffices] = useState<Office[]>(p.offices ?? [...OFFICES])

  const allOffices = offices.length === OFFICES.length

  function toggleOffice(o: Office) {
    setOffices(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o])
  }

  function save() {
    onSave({ display_name: name || null, is_admin: admin, offices: allOffices ? null : offices })
    setEditing(false)
  }

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{p.display_name || p.email}</div>
        {p.display_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.email}</div>}
        {isSelf && <span className="badge badge-blue">You</span>}
      </td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            {(['User', 'Admin'] as const).map(r => (
              <button key={r} onClick={() => setAdmin(r === 'Admin')}
                style={{ height: 22, padding: '0 8px', fontSize: 10, borderRadius: 100, cursor: 'pointer', border: '1px solid',
                  background: (r === 'Admin') === admin ? (admin ? 'var(--amber)' : 'var(--bg4)') : 'transparent',
                  color: (r === 'Admin') === admin ? (admin ? '#fff' : 'var(--text)') : 'var(--text3)',
                  borderColor: (r === 'Admin') === admin ? (admin ? 'var(--amber)' : 'var(--border2)') : 'var(--border)',
                  fontWeight: (r === 'Admin') === admin ? 600 : 400 }}>
                {r}
              </button>
            ))}
          </div>
        ) : (
          <span className={`badge ${p.is_admin ? 'badge-amber' : 'badge-gray'}`}>{p.is_admin ? 'Admin' : 'User'}</span>
        )}
      </td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <button onClick={() => setOffices([...OFFICES])}
              style={{ height: 22, padding: '0 6px', fontSize: 10, borderRadius: 100, cursor: 'pointer', border: '1px solid var(--border)', background: allOffices ? 'var(--bg4)' : 'transparent', color: 'var(--text3)' }}>All</button>
            {OFFICES.map(o => {
              const active = offices.includes(o)
              return <button key={o} onClick={() => toggleOffice(o)}
                style={{ height: 22, padding: '0 6px', fontSize: 10, borderRadius: 100, cursor: 'pointer', fontWeight: active ? 600 : 400,
                  background: active ? OFFICE_COLORS[o] : 'transparent', color: active ? '#fff' : 'var(--text3)',
                  border: `1px solid ${active ? OFFICE_COLORS[o] : 'var(--border)'}` }}>{o}</button>
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {p.offices === null
              ? <span className="badge badge-gray">All Offices</span>
              : p.offices.map(o => <span key={o} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 100, background: `${OFFICE_COLORS[o]}22`, color: OFFICE_COLORS[o], border: `1px solid ${OFFICE_COLORS[o]}`, fontWeight: 600 }}>{o}</span>)
            }
          </div>
        )}
      </td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-primary btn-sm" style={{ fontSize: 11 }} onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
            <button className="btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setEditing(false)}>✕</button>
          </div>
        ) : (
          <button className="btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setEditing(true)}>Edit</button>
        )}
      </td>
    </tr>
  )
}
