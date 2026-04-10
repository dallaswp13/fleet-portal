-- Daily fleet snapshots for trend tracking
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date date NOT NULL UNIQUE,
  online_count  integer NOT NULL DEFAULT 0,
  offline_count integer NOT NULL DEFAULT 0,
  inactive_count integer NOT NULL DEFAULT 0,
  device_count  integer NOT NULL DEFAULT 0,
  open_issues   integer NOT NULL DEFAULT 0,
  line_count    integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_snapshots_date ON daily_snapshots (snapshot_date DESC);

-- RPC to record today's snapshot (idempotent — upserts)
CREATE OR REPLACE FUNCTION record_daily_snapshot()
RETURNS void AS $$
BEGIN
  INSERT INTO daily_snapshots (snapshot_date, online_count, offline_count, inactive_count, device_count, open_issues, line_count)
  SELECT
    CURRENT_DATE,
    COALESCE(SUM(CASE WHEN v.online_status ILIKE 'Online%' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN v.online_status ILIKE 'Offline%' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN v.online_status NOT ILIKE 'Online%' AND v.online_status NOT ILIKE 'Offline%' THEN 1 ELSE 0 END), 0),
    (SELECT COUNT(*) FROM devices),
    (SELECT COUNT(*) FROM issues WHERE status = 'open'),
    (SELECT COUNT(*) FROM verizon_lines)
  FROM vehicles v
  ON CONFLICT (snapshot_date) DO UPDATE SET
    online_count   = EXCLUDED.online_count,
    offline_count  = EXCLUDED.offline_count,
    inactive_count = EXCLUDED.inactive_count,
    device_count   = EXCLUDED.device_count,
    open_issues    = EXCLUDED.open_issues,
    line_count     = EXCLUDED.line_count,
    created_at     = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
