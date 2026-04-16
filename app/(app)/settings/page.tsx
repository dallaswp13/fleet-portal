import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import UpdateDBContent from '@/components/UpdateDBContent'
import UserManager from '@/components/UserManager'
import InvoiceGenerator from '@/components/InvoiceGenerator'
import ExportDataPanel from '@/components/ExportDataPanel'
import FleetReconcile from '@/components/FleetReconcile'

const PER_PAGE = 50

const ACTION_LABELS: Record<string, string> = {
  reboot: 'Reboot', wipe: 'Factory Wipe', kiosk_enter: 'Kiosk Enter',
  kiosk_exit: 'Kiosk Exit', clear_app_data: 'Clear App Data',
  activate_sim: 'Activate SIM', import_ccsi: 'Import CCSI',
  import_devices: 'Import Devices', import_verizon: 'Import Verizon',
}

interface SearchParams { page?: string; tab?: string }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const tab    = params.tab ?? 'audit'
  const page   = Math.max(0, parseInt(params.page ?? '0', 10))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Check if current user is admin
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user?.id ?? '')
    .single()
  const isAdmin = profile?.is_admin === true

  // Also allow admin via env var (bootstrap before DB profile exists)
  const adminEmail = process.env.ADMIN_EMAIL ?? ''
  const isAdminByEnv = adminEmail && user?.email === adminEmail

  const canManageUsers = isAdmin || isAdminByEnv

  // Audit log
  const { data: logs, count } = await supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)
  const totalPages = Math.ceil((count ?? 0) / PER_PAGE)

  const tabDef = [
    { key: 'audit',   label: '📋 Audit Log'  },
    { key: 'roadmap', label: '🗺️ Roadmap'    },
    ...(canManageUsers ? [
      { key: 'db',        label: '⬆️ Update Database' },
      { key: 'reconcile', label: '🔄 Reconcile Fleet' },
      { key: 'export',    label: '📤 Export Data' },
      { key: 'users',     label: '👥 Manage Users'     },
      { key: 'invoice',   label: '🧾 Generate Invoice'  },
    ] : []),
  ]

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1>Settings</h1><p>System configuration, database management, and audit history</p></div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {tabDef.map(t => (
          <Link key={t.key} href={`/settings?tab=${t.key}`} className={`tab-link ${tab === t.key ? 'tab-active' : ''}`}>{t.label}</Link>
        ))}
      </div>

      {/* ── AUDIT LOG ── */}
      {tab === 'audit' && (
        <div className="card">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{(count ?? 0).toLocaleString()} total actions</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th><th>Action</th><th>Vehicle #</th>
                  <th>Target</th><th>Type</th><th>User</th><th>Result</th>
                </tr>
              </thead>
              <tbody>
                {(logs ?? []).map(log => (
                  <tr key={log.id}>
                    <td className="mono text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${log.action === 'wipe' ? 'badge-red' : log.action?.startsWith('import') ? 'badge-blue' : 'badge-gray'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td>{log.vehicle_number ? <span className="tag">#{log.vehicle_number}</span> : <span className="text-dim">—</span>}</td>
                    <td className="mono truncate" style={{ maxWidth: 200, fontSize: 11 }}>{log.target_id}</td>
                    <td><span className="badge badge-gray">{log.target_type}</span></td>
                    <td className="text-dim truncate" style={{ maxWidth: 180, fontSize: 11 }}>{log.user_email}</td>
                    <td><span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>{log.success ? '✓ OK' : '✗ Failed'}</span></td>
                  </tr>
                ))}
                {(!logs || logs.length === 0) && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>No audit records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page + 1} of {totalPages}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Link href={`/settings?tab=audit&page=${page - 1}`} className="btn-secondary btn-sm"
                  style={{ pointerEvents: page === 0 ? 'none' : 'auto', opacity: page === 0 ? 0.4 : 1 }}>← Prev</Link>
                <Link href={`/settings?tab=audit&page=${page + 1}`} className="btn-secondary btn-sm"
                  style={{ pointerEvents: page >= totalPages - 1 ? 'none' : 'auto', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next →</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── UPDATE DATABASE ── */}
      {tab === 'db' && <UpdateDBContent />}

      {/* ── FLEET RECONCILE ── */}
      {tab === 'reconcile' && canManageUsers && <FleetReconcile />}
      {tab === 'reconcile' && !canManageUsers && (
        <div className="alert alert-error">You do not have permission to reconcile the fleet.</div>
      )}

      {/* ── USER MANAGEMENT ── */}
      {tab === 'users' && canManageUsers && (
        <UserManager currentUserEmail={user?.email ?? ''} />
      )}
      {tab === 'users' && !canManageUsers && (
        <div className="alert alert-error">You do not have permission to manage users.</div>
      )}

      {tab === 'invoice' && canManageUsers && <InvoiceGenerator />}

      {/* ── EXPORT DATA ── */}
      {tab === 'export' && canManageUsers && <ExportDataPanel />}
      {tab === 'export' && !canManageUsers && (
        <div className="alert alert-error">You do not have permission to export data.</div>
      )}

      {tab === 'roadmap' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Launch Roadmap</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24 }}>
            Outstanding items before the site is fully operational.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              // ── IN PROGRESS / TO DO ──────────────────────────────────────
              {
                status: 'todo', label: 'Create Vehicle — M360 User Provisioning',
                detail: 'Quick Action to provision a new cab end-to-end: prompts for cab number + fleet, creates two M360 users via API (driver in front group, *pim in pim group), pulls an available Verizon line, and writes the row to the vehicles table. API plumbing is unblocked — this is now UI + orchestration work.',
              },
              {
                status: 'todo', label: 'Get Available Line — Quick Action',
                detail: 'Surface the first available unassigned Verizon line for a given office/fleet and mark it as reserved for a cab. Uses the existing count_available_lines RPC — just needs a modal and an "assign to vehicle" write path.',
              },
              {
                status: 'todo', label: 'Bulk Actions on Fleet Tab',
                detail: 'Multi-select checkboxes across the Fleet Vehicles and Devices views with bulk reboot, bulk kiosk toggle, bulk clear-dispatch, bulk export. Useful for end-of-shift sweeps and fleet-wide updates after an app rollout.',
              },
              {
                status: 'todo', label: 'Inbox — Expand Beyond ASC',
                detail: 'Inbox currently handles the ASC Twilio number only. Wire CYC, SDY, and DEN numbers through the same webhook pipeline with per-office routing so dispatchers for those fleets can use the same inbox.',
              },
              {
                status: 'todo', label: 'Inbound Voice Calls',
                detail: 'Twilio voice webhook + call-routing UI: log inbound driver calls against their vehicle, with voicemail transcription via Claude and optional call-back from the Inbox. Extends SMS two-way comms to phone.',
              },
              {
                status: 'todo', label: 'Stuck Message Monitoring',
                detail: 'Dashboard alert when an inbound SMS has been in "Pending" state for > 15 minutes without being committed, executed, or explicitly ignored. Prevents driver requests from silently falling through the cracks when Claude is offline.',
              },
              {
                status: 'todo', label: 'Issue Tracker — Full Page',
                detail: 'Dashboard summary widget exists. Build out dedicated /issues page with create/edit/assign/resolve, priority and office filtering, comment threads, and links to the affected vehicle or device.',
              },
              {
                status: 'todo', label: 'Daily Snapshot Job',
                detail: 'Populate the daily_snapshots table via a cron at /api/cron/snapshot so the Fleet Trend chart shows live data instead of the hardcoded Active Vehicle Tracker values currently in the dashboard.',
              },
              {
                status: 'todo', label: 'Scheduled Maintenance Reminders',
                detail: 'Auto-flag vehicles overdue for service based on last-service date and mileage. Surface as a Dashboard widget and a daily digest email to office managers.',
              },
              {
                status: 'todo', label: 'Inventory Reorder Triggers',
                detail: 'Low-stock thresholds on the Inventory page that fire a Slack/email alert when a part or tablet spare drops below a configurable floor. Pairs with a simple reorder log to track open POs.',
              },
              {
                status: 'todo', label: 'Driver Self-Service Portal',
                detail: 'Lightweight driver-facing page (SMS magic link) to update name/phone/license expiry, view their current vehicle assignment, and flag maintenance issues without going through dispatch.',
              },
              {
                status: 'todo', label: 'Driver Lookup by Phone',
                detail: 'When an SMS arrives from an unknown phone, auto-match against the Drivers table (normalized phone). Pre-fills sender name and vehicle in the Inbox so dispatchers see context immediately.',
              },
              {
                status: 'todo', label: 'Invite Users',
                detail: 'Admin flow to invite teammates by email — sends a Supabase magic-link invite, pre-assigns role (admin/viewer) and office scope. Replaces manual DB row creation in Manage Users.',
              },
              {
                status: 'todo', label: 'Automated Data Sync',
                detail: 'Replace the four manual CSV/XLSX uploads (Fleet, Devices, Verizon, Drivers) with scheduled pulls directly from MaaS360, Verizon, and CCSI. Eliminates the weekly upload chore.',
              },
              {
                status: 'todo', label: 'Audit Log Retention & Search',
                detail: 'Audit log is growing quickly. Add a retention policy (trim > 180 days) plus a dedicated search/filter UI on the audit tab — filter by actor, action type, vehicle, and date range.',
              },
              {
                status: 'todo', label: 'Mobile-Friendly Layout',
                detail: 'Fleet, Inbox, and Quick Actions are usable on desktop only. Tighten breakpoints and add a collapsible sidebar so dispatchers can use the portal on a phone when walking the yard.',
              },

            ] as { status: string; label: string; detail: string }[]).map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius-lg)', borderLeft: `3px solid ${item.status === 'done' ? 'var(--green)' : item.status === 'blocked' ? 'var(--red)' : 'var(--amber)'}` }}>
                <div style={{ fontSize: 16, flexShrink: 0, paddingTop: 1 }}>
                  {item.status === 'done' ? '✅' : item.status === 'blocked' ? '🔴' : '🟡'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{item.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text3)' }}>
            🟡 To Do
          </div>
        </div>
      )}
      {tab === 'invoice' && !canManageUsers && (
        <div className="alert alert-error">You do not have permission to access this feature.</div>
      )}
    </div>
  )
}
