-- RPC function to count available (unassigned) Verizon lines entirely in the DB.
-- This avoids passing hundreds of phone norms in URL query parameters which can
-- exceed PostgREST/Supabase URL length limits.

-- Indexes to speed up phone norm lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_driver_phone_norm
  ON vehicles(driver_phone_norm) WHERE driver_phone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_pim_phone_norm
  ON vehicles(pim_phone_norm) WHERE pim_phone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verizon_lines_phone_norm
  ON verizon_lines(phone_norm) WHERE phone_norm IS NOT NULL;

-- Function: count available lines (not matched to any vehicle)
CREATE OR REPLACE FUNCTION count_available_lines(
  p_offices text[] DEFAULT NULL
) RETURNS bigint AS $$
  SELECT count(*)
  FROM verizon_lines vl
  WHERE vl.account_number NOT IN ('571689935-00007', '571689935-00009')
  AND NOT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.driver_phone_norm = vl.phone_norm
       OR v.pim_phone_norm = vl.phone_norm
  )
  AND (p_offices IS NULL OR vl.office = ANY(p_offices) OR vl.office IS NULL);
$$ LANGUAGE sql STABLE;

-- Function: get available line phone_norms for a page
-- Returns just the phone_norms so the caller can use .in() with a small set
CREATE OR REPLACE FUNCTION get_available_line_norms(
  p_offices text[] DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE(norm text) AS $$
  SELECT vl.phone_norm as norm
  FROM verizon_lines vl
  WHERE vl.account_number NOT IN ('571689935-00007', '571689935-00009')
  AND NOT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.driver_phone_norm = vl.phone_norm
       OR v.pim_phone_norm = vl.phone_norm
  )
  AND (p_offices IS NULL OR vl.office = ANY(p_offices) OR vl.office IS NULL)
  ORDER BY vl.phone_number
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE sql STABLE;
