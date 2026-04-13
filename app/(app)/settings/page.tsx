import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import UpdateDBContent from '@/components/UpdateDBContent'
import UserManager from '@/components/UserManager'
import InvoiceGenerator from '@/components/InvoiceGenerator'
import ExportDataPanel from '@/components/ExportDataPanel'

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
      { key: 'db',      label: '⬆️ Update Database' },
      { key: 'export',  label: '📤 Export Data' },
      { key: 'users',   label: '👥 Manage Users'     },
      { key: 'invoice', label: '🧾 Generate Invoice'  },
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
            Remaining items before the site is fully operational.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              // ── ACTIVE / IN FLIGHT ────────────────────────────────────────
              {
                status: 'blocked', label: 'MaaS360 API — Command Execution',
                detail: 'Authentication is working (token auth + keepalive stable). Device action commands (reboot, wipe, kiosk, clear app data) are returning errors from M360. Needs troubleshooting — likely an endpoint or XML payload format issue. Search and device lookup work; sendAction is the blocker.',
              },
              {
                status: 'todo', label: 'Twilio SMS — Outbound Replies',
                detail: 'Inbound via Gmail/Google Voice is working. Need to wire /api/sms/send to Twilio REST API for outbound replies from the Inbox, plus webhook endpoint for direct Twilio inbound. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in Vercel. Run migration 027 in Supabase first.',
              },
              {
                status: 'todo', label: 'Create Vehicle — M360 User Provisioning',
                detail: 'Quick Action to provision a new cab: prompts for cab number + fleet, then creates two M360 users via API — driver (front group) and *pim (pim group). Depends on M360 command execution being unblocked.',
              },
              {
                status: 'todo', label: 'Invite Users',
                detail: 'Admin flow to invite teammates by email — sends Supabase magic-link invite, pre-assigns role (admin/viewer) and office scope. Replaces manual DB row creation in Manage Users.',
              },
              {
                status: 'todo', label: 'Scheduled Maintenance Reminders',
                detail: 'Auto-flag vehicles overdue for service based on last-service date and mileage. Surface as a Dashboard widget and daily digest email.',
              },
              {
                status: 'todo', label: 'Automated Data Sync',
                detail: 'Replace the four manual CSV/XLSX uploads (Fleet, Devices, Verizon, Drivers) with scheduled pulls directly from MaaS360, Verizon, and CCSI. Removes the weekly upload chore.',
              },
              {
                status: 'todo', label: 'Driver Lookup by Phone',
                detail: 'When an SMS arrives from an unknown phone, attempt auto-match against the Drivers table (normalized phone). Pre-fills sender name and vehicle in the Inbox.',
              },
              {
                status: 'todo', label: 'Bulk Actions',
                detail: 'Multi-select on Vehicles and Devices pages with bulk reboot, bulk kiosk toggle, bulk export. Useful for end-of-shift or fleet-wide operations.',
              },
              {
                status: 'todo', label: 'Issue Tracker — Full Page',
                detail: 'Dashboard summary widget exists. Build out dedicated /issues page with create/edit/assign/resolve, filtering by priority and office, and linking to vehicles.',
              },
              {
                status: 'todo', label: 'Daily Snapshot Job',
                detail: 'Populate daily_snapshots table (migration 028) via a cron at /api/cron/snapshot so the Fleet Trend chart shows live data instead of hardcoded Active Vehicle Tracker values.',
              },

              // ── RECENTLY COMPLETED ────────────────────────────────────────
              {
                status: 'done', label: 'Gmail OAuth — Connected',
                detail: 'GMAIL_CREDENTIALS set in Vercel. Poll Now pulls real driver SMS messages from Google Voice. Inbox showing live + demo messages.',
              },
              {
                status: 'done', label: 'Available Lines — DB-Side Filtering',
                detail: 'Migration 025 applied. Available tab uses RPC for accurate counts on large datasets.',
              },
              {
                status: 'done', label: 'Dashboard Widgets',
                detail: 'SMS Activity Feed, Issue Tracker Summary, Verizon Usage Alerts, and Fleet Size Trend chart all live on the home dashboard.',
              },
              {
                status: 'done', label: 'Top Bar Status Indicators',
                detail: 'Twilio SMS and MaaS360 API status dots live in the top bar with click-to-expand tooltips and recheck. Claude button simplified to Anthropic-only.',
              },
              {
                status: 'done', label: 'Unassociated Devices View',
                detail: 'Migration 029 added a NOT EXISTS view to handle 2000+ unassociated devices without hitting PostgREST URL length limits.',
              },
              {
                status: 'done', label: 'SMS Inbox — Two-Way Chat UI',
                detail: 'iMessage-style bubbles, outbound on the right, auto-reply teal gradient. Conversations grouped by phone with sender labels.',
              },
              {
                status: 'done', label: 'SMS Translation',
                detail: 'Non-English messages translated via Claude API at poll time (Spanish, Russian, Armenian, Farsi). Original + translation shown side-by-side in Inbox.',
              },
              {
                status: 'done', label: 'SMS Inbox — Commit & Execute',
                detail: 'Messages parsed for intent and vehicle. Execute button fires M360 commands directly. Destructive actions require confirmation.',
              },
              {
                status: 'done', label: 'MaaS360 Auth + XML Transport',
                detail: 'Auth working via XML transport with token cached in Supabase. Keepalive cron runs every 30 min to prevent 60-min token expiry.',
              },
              {
                status: 'done', label: 'Quick Actions — Full Workflows',
                detail: 'Replace Tablet (wipe + log), Surrender Vehicle (wipe both + unseat + mark), Remote Support (reboot + clear dispatch + clear BT) all wired.',
              },
              {
                status: 'done', label: 'Sitewide Filters (Office / Fleet)',
                detail: 'Office and ASC sub-fleet filters applied server-side across Vehicles, Devices, Verizon, Drivers.',
              },
              {
                status: 'done', label: 'Server-Side Pagination & Filtering',
                detail: 'Vehicles, Devices, Verizon, Drivers all filter and paginate in the database with accurate counts.',
              },
              {
                status: 'done', label: 'Verizon Lines — Vehicle Association',
                detail: 'Phone-norm matching fixed. PIM and Driver phone filters run in the database.',
              },
              {
                status: 'done', label: 'Driver Photos',
                detail: 'Routed through /api/image-proxy to bypass S3 HTTP/CORS issues.',
              },
              {
                status: 'done', label: 'Export Data — Persistent Preferences',
                detail: 'Export Data panel remembers column selections and filters between sessions via localStorage.',
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
            🔴 Blocked &nbsp;·&nbsp; 🟡 To Do &nbsp;·&nbsp; ✅ Done
          </div>
        </div>
      )}
      {tab === 'invoice' && !canManageUsers && (
        <div className="alert alert-error">You do not have permission to access this feature.</div>
      )}
    </div>
  )
}
