-- View for devices not matched to any vehicle by name_key
-- Solves PostgREST URL length limit when excluding thousands of associated IDs
CREATE OR REPLACE VIEW unassociated_devices AS
SELECT d.*
FROM devices d
WHERE NOT EXISTS (
  SELECT 1 FROM vehicles v
  WHERE v.vehicle_name_key IS NOT NULL
    AND v.vehicle_name_key = d.name_key
);
