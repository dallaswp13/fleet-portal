import { SkeletonStats, SkeletonTable } from '@/components/PageSkeleton'

export default function Loading() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <span className="skeleton" style={{ display: 'block', width: 180, height: 24, marginBottom: 8 }} />
          <span className="skeleton skeleton-text-sm" style={{ width: 220 }} />
        </div>
      </div>
      <SkeletonStats />
      <div className="card" style={{ marginTop: 16 }}>
        <SkeletonTable rows={8} cols={6} />
      </div>
    </div>
  )
}
