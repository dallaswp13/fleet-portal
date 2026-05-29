# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fleet Portal is the internal operations app for **LA Yellow Cab** (~1,000+ taxis across ASC sub-fleets E/L/S/Y/U). It ties together vehicle records, the tablets mounted in each cab, the Verizon SIMs powering them, and an SMS support line that drivers text when equipment fails. A driver can text "no payment" and the system can reboot the right tablet automatically. Next.js 15 (App Router) + Supabase, deployed on Vercel with CI/CD from GitHub.

## Commands

Package manager is **npm** (`package-lock.json`).

```bash
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm start        # serve production build
npm run lint     # next lint
```

**No test runner is configured** — there is no `npm test`. Don't assume tests exist; verify changes against the running app.

## Architecture

### Route groups (App Router)
- `app/(app)/*` — authenticated pages, guarded by `middleware.ts`. Layout (`app/(app)/layout.tsx`) renders the Sidebar + Topbar office/fleet filters.
- `app/login/`, `app/auth/`, `app/set-password/` — public auth pages.
- `app/api/*` — webhooks, CRUD, imports/exports, cron endpoints.

### Auth & authorization (the non-obvious part)
- Supabase Auth (email/password), enforced server-side in `middleware.ts`. Unauthenticated requests redirect to `/login`.
- **Public exemptions in middleware** — `/api/sms/webhook` (Twilio) and `/api/maas360/keepalive` (cron) must bypass auth. If you add an external webhook or cron route, add it to the middleware allowlist or it will 401.
- Authorization is a **single-role model with an admin flag**: `user_profiles.is_admin` (with an `ADMIN_EMAIL` env fallback). Admin-only pages: SMS, Rylo, Data Audit, Settings. Regular users see office-filtered Dashboard/Fleet/Inventory/Audit.
- Auth lookups are request-deduplicated via `lib/auth.ts` (`getCachedUser`, `getCachedProfile`, `getCachedIsAdmin`) using React `cache()`. Prefer these over re-querying Supabase.

### Supabase clients — pick the right one
- `lib/supabase/client.ts` — browser client (`@supabase/ssr` `createBrowserClient`).
- `lib/supabase/server.ts` — server client with cookie handling; also exposes a **service-role** client that bypasses RLS for admin writes. All tables have RLS enabled, so reads/writes that must ignore RLS go through the service-role path. Be deliberate about which you use.

### The SMS pipeline (`lib/smsProcess.ts`) — the core domain flow
Inbound text → `sms_inbound` row → **keyword rule match** (`sms_rules` table) → if no rule matches, **Claude intent parsing** using `lib/claude-playbook.md` as the system prompt → vehicle lookup → optional auto-reply → MaaS360 action → outcome logged. Low-confidence intents **escalate to a human via Resend email** (`lib/email.ts`, `ESCALATION_TO`).

> `next.config.ts` has a special `outputFileTracingIncludes` entry so `/api/sms/webhook` bundles `lib/claude-playbook.md`. If you move or rename that playbook, update the config or the webhook breaks in production.

### MaaS360 device management (`lib/maas360.ts`, `lib/maas360Exec.ts`)
HCL/IBM MaaS360 is an **XML API** (parsed with `fast-xml-parser`). It executes remote actions on tablets — reboot, wipe, kiosk lock, clear app data. The session token lives in-memory **and** is persisted to the `maas360_token` Supabase table (survives serverless cold starts); `/api/maas360/keepalive` is a cron that refreshes it every ~30 min. All actions write to `audit_log`.

### Domain model you must understand before touching SMS/device code
Each vehicle has up to **two tablets** and they are NOT interchangeable:
- **Driver tablet** (front) — dispatch + payment app. Reboot/wipe/kiosk target.
- **PIM** (back-seat Passenger Info Monitor) — has the Square card reader. "NoP"/"no payment" usually means **restart the PIM**, a *separate* `m360_device_id`.
- **Meter** — physical hardware. "NoM"/"meter not working" is **not remotely fixable**; do not reboot the driver tablet for it.

Vehicles are keyed by `vehicle_number` (3–4 digits) within a `fleet_id` (E/L/S/Y/U). Source-of-truth vehicle data comes from `CCSI.xlsx`; Verizon line data is CSV-imported into `verizon_lines`. Importers live in `scripts/` (Python).

### Styling
**No Tailwind, no component library.** Styling is CSS variables in `app/globals.css` (`--bg`, `--text`, `--accent`, etc.) with inline-styled React components. Dark theme by default. Match the existing CSS-variable approach rather than introducing a CSS framework.

### Data / caching conventions
- Server Components fetch directly from Supabase; `'use client'` only for interactive UI.
- Page data uses `unstable_cache()`; auth uses React `cache()`. URL search params (`?offices=...&asc_fleets=...`) carry office/fleet filters across pages — see `lib/filters.ts` for the shared constants.

## Database
Migrations live in `supabase/migrations/` (47+, numbered `NNN_*.sql`). Core tables: `vehicles`, `devices`, `verizon_lines`, `audit_log`, `sms_inbound`/`sms_outbound`, `sms_rules`, `issues`, `inventory_items`, `user_profiles`, `maas360_token`. Add changes as a new numbered migration rather than editing existing ones.

## Environment
Copy `.env.local.example`. Required groups: Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), MaaS360 (`MAAS360_*`), Twilio (`TWILIO_*`), `ANTHROPIC_API_KEY`, Resend (`RESEND_API_KEY`, `ESCALATION_TO`), and `CRON_SECRET` for cron endpoints.

## TypeScript note
`tsconfig.json` is intentionally relaxed (`strict: false`, `noImplicitAny: false`). Path alias `@/*` maps to the project root. See `README.md` for fuller setup/deploy notes and `lib/claude-playbook.md` for the full SMS support knowledge base.
