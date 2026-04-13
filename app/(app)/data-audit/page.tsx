import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllChecks } from '@/lib/audit-checks'
import DataAuditorView from '@/components/DataAuditorView'

export const dynamic = 'force-dynamic'

export default async function DataAuditPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.is_admin === true || user.email === (process.env.ADMIN_EMAIL ?? '')
  if (!isAdmin) redirect('/')

  const svc = await createServiceClient()
  const runAt = new Date().toISOString()
  let sections
  let error: string | null = null
  try {
    sections = await runAllChecks(svc)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to run audit checks'
    sections = []
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Data Audit</h1>
          <p>Cross-source integrity checks — CCSI, Verizon, MaaS360, and driver records.</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <DataAuditorView sections={sections} runAt={runAt} />
    </div>
  )
}
