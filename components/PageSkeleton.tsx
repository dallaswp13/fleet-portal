/**
 * Shared skeleton placeholders for data-loading states.
 *
 * Use these instead of <span className="spinner" /> for page/section loading.
 * Button-internal spinners (disabled state while saving) should stay as spinners.
 */

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" style={{ padding: '8px 16px' }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <span
              key={c}
              className="skeleton"
              style={{
                height: 14,
                flex: c === 0 ? '0 0 40px' : c === cols - 1 ? '0 0 80px' : 1,
                opacity: 1 - r * 0.05,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="skeleton skeleton-avatar" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="skeleton skeleton-text" style={{ width: '40%' }} />
            <span className="skeleton skeleton-text-sm" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card skeleton-stack">
      <span className="skeleton skeleton-text" style={{ width: '30%', height: 16 }} />
      <span className="skeleton skeleton-text" />
      <span className="skeleton skeleton-text" style={{ width: '80%' }} />
      <span className="skeleton skeleton-text" style={{ width: '60%' }} />
    </div>
  )
}

export function SkeletonBlock({ height = 120 }: { height?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: '100%', height }} />
}

export function SkeletonStats({ count = 6 }: { count?: number }) {
  return (
    <div className="grid-stats">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          <span className="skeleton skeleton-text-sm" style={{ width: '50%' }} />
          <span className="skeleton" style={{ height: 26, marginTop: 10, width: '60%' }} />
          <span className="skeleton skeleton-text-sm" style={{ width: '80%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  )
}
