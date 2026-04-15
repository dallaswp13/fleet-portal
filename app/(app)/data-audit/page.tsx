import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllChecks, applyIgnores } from '@/lib/audit-checks'
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
  let ignoredList: { section_id: string; row_key: string; reason: string | null; ignored_by: string; ignored_at: string }[] = []
  let error: string | null = null
  try {
    // Run checks and load the ignore list in parallel — they're independent.
    const [allSections, ignoresQ] = await Promise.all([
      runAllChecks(svc),
      svc.from('audit_ignores').select('section_id, row_key, reason, ignored_by, ignored_at'),
    ])
    const ignoreRows = (ignoresQ.data ?? []) as typeof ignoredList
    ignoredList = ignoreRows
    const ignoreSet = new Set(ignoreRows.map(r => `${r.section_id}|${r.row_key}`))
    sections = applyIgnores(allSections, ignoreSet)
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

      <DataAuditorView sections={sections} runAt={runAt} ignoredList={ignoredList} />
    </div>
  )
}
