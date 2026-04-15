'use client'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'

interface Props {
  fleetStatus:  { online: number; offline: number; inactive: number }
  topUsage:     { device: string; vehicle: string; vehicleNumber: number | null; gb: number; office: string }[]
}

function DonutChart({ slices, size = 120, onSliceClick }: {
  slices: { value: number; color: string; label: string; filter?: string }[]
  size?: number
  onSliceClick?: (filter: string) => void
}) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total === 0) return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>No data</span>
    </div>
  )

  const cx = size / 2, cy = size / 2, r = size / 2 - 8, innerR = r * 0.58
  let cumAngle = -Math.PI / 2

  const paths = slices.filter(s => s.value > 0).map(s => {
    const angle = (s.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(cumAngle), y1 = cy + r * Math.sin(cumAngle)
    cumAngle += angle
    const x2 = cx + r * Math.cos(cumAngle), y2 = cy + r * Math.sin(cumAngle)
    const ix1 = cx + innerR * Math.cos(cumAngle - angle), iy1 = cy + innerR * Math.sin(cumAngle - angle)
    const ix2 = cx + innerR * Math.cos(cumAngle), iy2 = cy + innerR * Math.sin(cumAngle)
    const large = angle > Math.PI ? 1 : 0
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`
    return { d, color: s.color, filter: s.filter, label: s.label }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ cursor: onSliceClick ? 'pointer' : 'default' }}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} stroke="var(--bg2)" strokeWidth="1.5"
          onClick={() => p.filter && onSliceClick?.(p.filter)}
          style={{ transition: 'opacity 0.15s', opacity: 1 }}
          onMouseEnter={e => { if (p.filter) (e.target as SVGPathElement).style.opacity = '0.75' }}
          onMouseLeave={e => { (e.target as SVGPathElement).style.opacity = '1' }} />
      ))}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text)">{total.toLocaleString()}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="var(--text3)">total</text>
    </svg>
  )
}

export default function DashboardCharts({ fleetStatus, topUsage }: Props) {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const { online, offline, inactive } = fleetStatus

  function navToVehicles(statusFilter: string) {
    // Preserve existing office/fleet params, add status filter
    const p = new URLSearchParams(searchParams.toString())
    p.set('q', statusFilter)
    router.push(`/fleet/vehicles?${p.toString()}`)
  }

  const statusSlices = [
    { value: online,   color: 'var(--green)', label: 'Online',   filter: 'Online'   },
    { value: offline,  color: 'var(--amber)', label: 'Offline',  filter: 'Offline'  },
    { value: inactive, color: 'var(--text3)', label: 'Inactive', filter: 'Inactive' },
  ]

  const maxUsage = Math.max(...topUsage.map(u => u.gb), 1)

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', padding: '16px 20px', flex: '1 1 220px',
  }
  const headStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16,
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

      {/* Fleet Status donut — click a slice to filter vehicles */}
      <div style={cardStyle}>
        <div style={headStyle}>Fleet Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <DonutChart slices={statusSlices} onSliceClick={navToVehicles} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {statusSlices.map(s => (
              <button key={s.label}
                onClick={() => navToVehicles(s.filter)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 6, textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginLeft: 'auto', paddingLeft: 16 }}>{s.value.toLocaleString()}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>→</span>
              </button>
            ))}
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, paddingLeft: 6 }}>Click to filter Vehicles</div>
          </div>
        </div>
      </div>

      {/* Top data usage — click row to go to that vehicle */}
      <div style={{ ...cardStyle, flex: '2 1 360px' }}>
        <div style={headStyle}>Top Data Usage This Cycle (GB) — click to open vehicle</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topUsage.map((u, i) => (
            <div key={i}
              onClick={() => u.vehicleNumber && router.push(`/fleet/vehicles?q=${u.vehicleNumber}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px', borderRadius: 6, cursor: u.vehicleNumber ? 'pointer' : 'default' }}
              onMouseEnter={e => { if (u.vehicleNumber) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
              <div style={{ width: 100, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'var(--font-mono)' }}
                title={u.device}>{u.device}</div>
              <div style={{ flex: 1, background: 'var(--bg4)', borderRadius: 4, height: 14, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  width: `${(u.gb / maxUsage) * 100}%`,
                  background: u.gb > maxUsage * 0.8 ? 'var(--red)' : u.gb > maxUsage * 0.5 ? 'var(--amber)' : 'var(--blue)',
                  height: '100%', borderRadius: 4,
                }} />
              </div>
              <div style={{ width: 42, fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'right', flexShrink: 0 }}>{u.gb.toFixed(1)}</div>
              {u.vehicle && <span className="badge badge-gray" style={{ fontSize: 10, flexShrink: 0 }}>{u.vehicle}</span>}
            </div>
          ))}
          {topUsage.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12 }}>No usage data for selected filters.</div>}
        </div>
      </div>

    </div>
  )
}
