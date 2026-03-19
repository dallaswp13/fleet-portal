import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const PER_PAGE = 50
const ACTION_LABELS: Record<string, string> = {
  reboot: 'Reboot', wipe: 'Factory Wipe', kiosk_enter: 'Kiosk Enter',
  kiosk_exit: 'Kiosk Exit', clear_app_data: 'Clear App Data',
  activate_sim: 'Activate SIM', import_ccsi: 'Import CCSI',
  import_devices: 'Import Devices', import_verizon: 'Import Verizon',
}

interface SearchParams { page?: string }

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const page   = Math.max(0, parseInt(params.page ?? '0', 10))

  const supabase = await createClient()
  const { data: logs, error, count } = await supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

  if (error) return (
    <div className="page-content">
      <div className="alert alert-error">Failed to load audit log: {error.message}</div>
    </div>
  )

  const totalPages = Math.ceil((count ?? 0) / PER_PAGE)

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>{(count ?? 0).toLocaleString()} total actions</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th><th>Action</th><th>Vehicle #</th>
                <th>Target ID</th><th>Type</th><th>User</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map(log => (
                <tr key={log.id}>
                  <td className="mono text-dim" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className={`badge ${log.action === 'wipe' ? 'badge-red' : log.action?.startsWith('import') ? 'badge-blue' : 'badge-gray'}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td>{log.vehicle_number ? <span className="tag">#{log.vehicle_number}</span> : <span className="text-dim">—</span>}</td>
                  <td className="mono" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.target_id}
                  </td>
                  <td><span className="badge badge-gray">{log.target_type}</span></td>
                  <td className="text-dim" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.user_email}
                  </td>
                  <td><span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>{log.success ? '✓ OK' : '✗ Failed'}</span></td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--text3)' }}>No audit records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page + 1} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link href={`/audit?page=${page - 1}`} className={`btn-secondary btn-sm ${page === 0 ? 'disabled' : ''}`}
                style={{ pointerEvents: page === 0 ? 'none' : 'auto', opacity: page === 0 ? 0.4 : 1 }}>← Prev</Link>
              <Link href={`/audit?page=${page + 1}`} className={`btn-secondary btn-sm ${page >= totalPages - 1 ? 'disabled' : ''}`}
                style={{ pointerEvents: page >= totalPages - 1 ? 'none' : 'auto', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next →</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
