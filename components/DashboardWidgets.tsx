'use client'
import { useRouter } from 'next/navigation'

/* ── Types ─────────────────────────────────────────────────── */
interface SmsActivity {
  recentMessages: { sender: string; sms_text: string; received_at: string; action: string | null; success: boolean | null }[]
  totalToday: number
  unprocessedCount: number
}

interface IssueSummary {
  highCount: number
  mediumCount: number
  lowCount: number
  totalOpen: number
  newest: { id: string; title: string; priority: string; created_at: string }[]
}

interface VerizonAlert {
  phone_number: string
  verizon_user: string | null
  monthly_usage_gb: number | null
  phone_status: string | null
  office: string | null
  alertType: 'high_usage' | 'suspended'
}

interface TrendPoint {
  date: string
  total: number
  asc: number
  cyc: number
  other: number
}

/* ── SMS Activity Feed ─────────────────────────────────────── */
export function SMSActivityFeed({ data }: { data: SmsActivity }) {
  const router = useRouter()
  const { recentMessages, totalToday, unprocessedCount } = data

  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>SMS Activity</h2>
        <a href="/sms" style={{ fontSize: 12, color: 'var(--accent)' }}>Open Inbox &rarr;</a>
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{totalToday}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: unprocessedCount > 0 ? 'var(--amber)' : 'var(--green)' }}>{unprocessedCount}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unprocessed</div>
        </div>
      </div>

      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {recentMessages.length > 0 ? recentMessages.map((m, i) => (
          <div key={i} style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}
            onClick={() => router.push('/sms')} className="hover-row">
            <div style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, flexShrink: 0,
              background: m.success === true ? 'var(--green)' : m.success === false ? 'var(--red)' : 'var(--text3)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{m.sender || 'Unknown'}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{formatTimeAgo(m.received_at)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.sms_text}
              </div>
              {m.action && m.action !== 'unknown' && (
                <span className={`badge ${m.success ? 'badge-green' : m.success === false ? 'badge-red' : 'badge-gray'}`}
                  style={{ fontSize: 9, marginTop: 3 }}>
                  {m.action}
                </span>
              )}
            </div>
          </div>
        )) : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>No recent messages.</div>
        )}
      </div>
    </div>
  )
}

/* ── Issue Tracker Summary ─────────────────────────────────── */
export function IssueTrackerSummary({ data }: { data: IssueSummary }) {
  const router = useRouter()

  const segments = [
    { count: data.highCount, color: 'var(--red)', label: 'High' },
    { count: data.mediumCount, color: 'var(--amber)', label: 'Medium' },
    { count: data.lowCount, color: 'var(--text3)', label: 'Low' },
  ]
  const total = data.totalOpen

  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Open Issues</h2>
        <a href="/rylo" style={{ fontSize: 12, color: 'var(--accent)' }}>View Tracker &rarr;</a>
      </div>

      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: total > 0 ? 'var(--text)' : 'var(--green)', marginBottom: 8 }}>
          {total}{' '}
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text3)' }}>open</span>
        </div>

        {/* Priority bar */}
        {total > 0 && (
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 12, background: 'var(--bg4)' }}>
            {segments.filter(s => s.count > 0).map(s => (
              <div key={s.label} style={{ width: `${(s.count / total) * 100}%`, background: s.color, minWidth: 4 }} />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {segments.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.count}</span>
            </div>
          ))}
        </div>

        {/* Newest issues */}
        {data.newest.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Newest</div>
            {data.newest.map(issue => (
              <div key={issue.id} onClick={() => router.push('/rylo')} className="hover-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: issue.priority === 'high' ? 'var(--red)' : issue.priority === 'medium' ? 'var(--amber)' : 'var(--text3)'
                }} />
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {issue.title}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{formatTimeAgo(issue.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Verizon Usage Alerts ──────────────────────────────────── */
export function VerizonUsageAlerts({ alerts, usageThreshold }: { alerts: VerizonAlert[]; usageThreshold: number }) {
  const router = useRouter()
  const highUsage  = alerts.filter(a => a.alertType === 'high_usage')
  const suspended  = alerts.filter(a => a.alertType === 'suspended')

  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Verizon Alerts</h2>
        <a href="/lines" style={{ fontSize: 12, color: 'var(--accent)' }}>View Lines &rarr;</a>
      </div>

      {alerts.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>&#10003;</div>
          <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>All Clear</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>No usage alerts or suspended lines</div>
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {suspended.length > 0 && (
            <>
              <div style={{ padding: '8px 20px', fontSize: 10, fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--bg3)' }}>
                Suspended Lines ({suspended.length})
              </div>
              {suspended.map((a, i) => (
                <div key={`s${i}`} onClick={() => router.push('/lines')} className="hover-row"
                  style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{a.phone_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.verizon_user || 'Unassigned'}{a.office ? ` · ${a.office}` : ''}</div>
                  </div>
                  <span className="badge badge-red" style={{ fontSize: 10 }}>Suspended</span>
                </div>
              ))}
            </>
          )}
          {highUsage.length > 0 && (
            <>
              <div style={{ padding: '8px 20px', fontSize: 10, fontWeight: 600, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--bg3)' }}>
                High Usage &gt; {usageThreshold} GB ({highUsage.length})
              </div>
              {highUsage.map((a, i) => (
                <div key={`u${i}`} onClick={() => router.push('/lines')} className="hover-row"
                  style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{a.phone_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.verizon_user || 'Unassigned'}{a.office ? ` · ${a.office}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>{Number(a.monthly_usage_gb ?? 0).toFixed(1)} GB</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Fleet Trend Chart ─────────────────────────────────────── */
export function FleetTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>Fleet Trends</h2>
        </div>
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>No trend data available.</div>
        </div>
      </div>
    )
  }

  const maxVal = Math.max(...data.map(d => d.total), 1)
  const minVal = Math.min(...data.map(d => Math.min(d.asc, d.cyc, d.other)))
  // Use a floor that shows meaningful variation
  const yFloor = Math.max(0, Math.floor(minVal * 0.9 / 50) * 50)
  const yRange = maxVal - yFloor

  const chartH = 200
  const chartW = Math.max(data.length * 48, 500)
  const padL = 48, padR = 16, padT = 14, padB = 32
  const innerW = chartW - padL - padR
  const innerH = chartH - padT - padB

  function x(i: number) { return padL + (i / (data.length - 1)) * innerW }
  function y(val: number) { return padT + innerH - ((val - yFloor) / yRange) * innerH }

  function line(values: number[], color: string, width = 2) {
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
    return <polyline key={color} points={pts} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" />
  }

  // Shaded area under total line
  function area(values: number[], color: string) {
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
    const bottom = `${x(values.length - 1)},${y(yFloor)} ${x(0)},${y(yFloor)}`
    return <polygon key={`area-${color}`} points={`${pts} ${bottom}`} fill={color} opacity="0.08" />
  }

  const totalVals = data.map(d => d.total)
  const ascVals   = data.map(d => d.asc)
  const cycVals   = data.map(d => d.cyc)
  const otherVals = data.map(d => d.other)

  const yTicks = [yFloor, Math.round(yFloor + yRange / 3), Math.round(yFloor + yRange * 2 / 3), maxVal]

  // Latest values for the stat summary
  const latest = data[data.length - 1]
  const prev   = data[data.length - 2]
  const totalDelta = latest.total - prev.total
  const ascDelta   = latest.asc - prev.asc

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Active Vehicle Trends</h2>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Monthly fleet size · Sep 2024 – Mar 2026</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{ width: 12, height: 3, background: 'var(--accent)', borderRadius: 2 }} /> Total
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{ width: 12, height: 3, background: 'var(--green)', borderRadius: 2 }} /> ASC
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{ width: 12, height: 3, background: 'var(--amber)', borderRadius: 2 }} /> CYC
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{ width: 12, height: 3, background: '#8b5cf6', borderRadius: 2 }} /> Other
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 24, padding: '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Total</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {latest.total.toLocaleString()}
            <span style={{ fontSize: 11, fontWeight: 500, color: totalDelta >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: 6 }}>
              {totalDelta >= 0 ? '+' : ''}{totalDelta}
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ASC</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
            {latest.asc.toLocaleString()}
            <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 6 }}>
              {ascDelta >= 0 ? '+' : ''}{ascDelta}
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CYC</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>{latest.cyc.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Other</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#8b5cf6' }}>{latest.other.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ padding: '16px 20px', overflowX: 'auto' }}>
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
          {/* Grid lines */}
          {yTicks.map(t => (
            <g key={t}>
              <line x1={padL} x2={chartW - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="3,3" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--text3)">{t.toLocaleString()}</text>
            </g>
          ))}
          {/* X-axis date labels */}
          {data.map((d, i) => {
            const show = data.length <= 20 || i % Math.ceil(data.length / 12) === 0 || i === data.length - 1
            return show ? (
              <text key={i} x={x(i)} y={chartH - 6} textAnchor="middle" fontSize="9" fill="var(--text3)">
                {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
              </text>
            ) : null
          })}
          {/* Shaded areas */}
          {area(totalVals, 'var(--accent)')}
          {/* Lines */}
          {line(totalVals, 'var(--accent)', 2.5)}
          {line(ascVals, 'var(--green)', 2)}
          {line(cycVals, 'var(--amber)', 1.5)}
          {line(otherVals, '#8b5cf6', 1.5)}
          {/* Dots on last point */}
          <circle cx={x(data.length - 1)} cy={y(latest.total)} r="4" fill="var(--accent)" />
          <circle cx={x(data.length - 1)} cy={y(latest.asc)} r="3.5" fill="var(--green)" />
          <circle cx={x(data.length - 1)} cy={y(latest.cyc)} r="3" fill="var(--amber)" />
          <circle cx={x(data.length - 1)} cy={y(latest.other)} r="3" fill="#8b5cf6" />
        </svg>
      </div>
    </div>
  )
}

/* ── Helpers ───────────────────────────────────────────────── */
function formatTimeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1)  return 'yesterday'
  if (days < 7)    return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
