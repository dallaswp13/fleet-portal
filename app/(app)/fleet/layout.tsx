import FleetTabs from '@/components/FleetTabs'

/**
 * Fleet tab layout — groups Vehicles / Devices / Verizon under a single
 * top-level "Fleet" section. Each sub-tab is its own route so that each
 * view keeps its own query-string filters, pagination, and sorting.
 *
 * The tab strip lives inside the page-content wrapper of each sub-page
 * (we render it here at the top, and child pages render their own
 * `page-content` below). To avoid double-wrapping, we don't add a wrapper
 * around {children}.
 */
export default function FleetLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FleetTabs />
      {children}
    </>
  )
}
