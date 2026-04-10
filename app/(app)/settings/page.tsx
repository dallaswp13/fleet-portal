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
              {
                status: 'done', label: 'MaaS360 API Integration',
                detail: 'Connected via XML transport. Reboot, kiosk, wipe, clear app data, and support actions all operational. Token cached in Supabase with auto-refresh.',
              },
              {
                status: 'done', label: 'SMS Inbox — Commit & Execute',
                detail: 'Messages are parsed for intent and vehicle. Execute button sends M360 commands directly. Destructive actions and low-confidence messages require confirmation. Messages grouped by sender.',
              },
              {
                status: 'blocked', label: 'Gmail OAuth',
                detail: 'GMAIL_CREDENTIALS env var must be set in Vercel with a base64-encoded Google OAuth client secret. Once connected, Poll Now will pull real driver SMS messages.',
              },
              {
                status: 'done', label: 'Driver Photos',
                detail: 'Routed through /api/image-proxy to bypass S3 HTTP/CORS. Re-import CCSI-drivers.xlsx to refresh URLs.',
              },
              {
                status: 'done', label: 'Quick Actions — Full Workflows',
                detail: 'Replace Tablet (wipe + log), Surrender Vehicle (wipe both + unseat + mark), and Remote Support (reboot + clear dispatch + clear BT) all wired to M360 API.',
              },
              {
                status: 'done', label: 'Sitewide Filters (Office / Fleet)',
                detail: 'Office and ASC sub-fleet filters are applied server-side across Vehicles, Devices, Verizon, and Drivers pages.',
              },
              {
                status: 'done', label: 'Verizon Lines — Vehicle Association',
                detail: 'Phone norm matching fixed. PIM and Driver phone filters now run in the database so counts and pagination are accurate.',
              },
              {
                status: 'todo', label: 'Available Lines — Enhanced Filtering',
                detail: 'Run migration 025 in Supabase SQL editor to enable DB-side available line filtering. Without it, the Available tab may show incorrect results for large datasets.',
              },
              {
                status: 'done', label: 'Server-Side Pagination & Filtering',
                detail: 'Vehicles, Devices, Verizon, and Drivers all filter and paginate in the database. Count and page numbers are always accurate.',
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
