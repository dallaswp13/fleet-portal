import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import TransactionsTable from '@/components/TransactionsTable'

const PER_PAGE = 200

interface SearchParams {
  page?: string; q?: string; sort?: string; dir?: string
  vehicle?: string
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params  = await searchParams
  const page    = Math.max(0, parseInt(params.page ?? '0', 10))
  const search  = params.q?.trim() ?? ''
  const sort    = params.sort ?? 'transaction_date'
  const dir     = params.dir !== 'asc'  // default descending (newest first)
  const vehicle = params.vehicle ?? ''

  const supabase = await createClient()

  // Check if transactions table has any data
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  if (!totalCount) {
    return (
      <div className="page-content">
        <div className="page-header"><div><h1>Transactions</h1><p>Square payment history by vehicle</p></div></div>
        <div className="card" style={{ padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💳</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No Transactions Yet</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 440, margin: '0 auto 24px' }}>
            Upload <code>transactions.csv</code> from your Square Dashboard via Update Database.
            Transactions will be matched to vehicles by the device name in the CSV.
          </p>
          <a href="/settings?tab=db" className="btn-primary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            ⬆️ Import transactions.csv
          </a>
        </div>
      </div>
    )
  }

  let query = supabase
    .from('transactions')
    .select('*, vehicles(vehicle_number, fleet_id, office)', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

  if (vehicle) query = query.ilike('device_name', `%${vehicle}%`)
  if (search) {
    const like = `%${search}%`
    query = query.or(`transaction_id.ilike.${like},device_name.ilike.${like},location.ilike.${like},description.ilike.${like},payment_type.ilike.${like}`)
  }

  const { data, count } = await query

  // Compute summary stats
  const { data: stats } = await supabase
    .from('transactions')
    .select('amount, status')

  const totalRevenue = (stats ?? [])
    .filter(t => t.status !== 'REFUNDED')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const totalRefunds = (stats ?? [])
    .filter(t => t.status === 'REFUNDED')
    .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p>{(count ?? 0).toLocaleString()} transactions · ${totalRevenue.toFixed(2)} revenue · ${totalRefunds.toFixed(2)} refunded</p>
        </div>
        <a href="/settings?tab=db" className="btn-secondary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          ⬆️ Import
        </a>
      </div>
      <Suspense fallback={null}>
        <TransactionsTable
          transactions={(data ?? []) as Record<string,unknown>[]}
          page={page} totalPages={Math.ceil((count ?? 0) / PER_PAGE)} totalCount={count ?? 0}
          search={search} sort={sort} dir={dir} vehicle={vehicle}
        />
      </Suspense>
    </div>
  )
}
