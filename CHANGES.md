# v1.16 Changes

## Dashboard — Devices Now Filters by Office
- Devices count now queries fleet_overview (which has office) instead of raw devices table
- All 6 dashboard metrics now respect the selected office + status filters

## Office Filter — ASC Last with Sub-Fleet Picker
- Office order changed to: CYC · SDY · DEN · ASC
- When ASC is selected, a sub-filter appears: E · L · S · Y · U fleet pills
- Sub-fleet filter stored in URL param `?asc_fleets=` and localStorage

## Drivers Tab (New)
- Photo grid with driver images from S3 (graceful fallback to 👤 placeholder)
- Fields: Lease # (Driver ID), Fleet, Office, Name, Email, Active status
- Click any driver to open detail panel
- Edit panel allows setting: Personal Phone # (for SMS linking), Seated Vehicle, Notes
- Filters by office filter in topbar (including ASC sub-fleets)
- Active / All tabs
- Import via Settings → Update Database using CCSI-drivers.xlsx

## Update Database — Drivers Support
- CCSI-drivers.xlsx now recognized and imported
- Upserts on Driver ID (Lease #), preserves personal_phone/notes/seated_vehicle
- Strips datetime query params from image URLs for clean storage

## Gmail OAuth — In-Portal Authentication
- "📧 Connect Gmail" button on SMS page starts OAuth flow directly in browser
- No need to run voice_poller.py locally — the portal handles the full OAuth flow
- Token stored in Supabase app_config table (persists across deployments)
- Falls back to GMAIL_TOKEN env var if DB token not set
- Requires GMAIL_CREDENTIALS env var + Google Cloud Console OAuth 2.0 setup
- Add redirect URI in Google Console: https://your-site.vercel.app/api/gmail/callback

## Database Migrations (run in order)
- 012_drivers.sql — drivers table, app_config table, driver_id FK on sms_messages

---
# v1.15.1 — Fix invalid route export
# v1.15 — SMS rules, vehicle linking, 9 action types
