# LA Yellow Cab — Driver Portal

## Project Overview

Build a standalone, driver-facing web portal for LA Yellow Cab. This is a self-service tool for ~600+ taxi drivers across four offices (ASC, CYC, SDY, DEN). It is **separate from the existing Fleet Portal** (an internal admin tool) but shares the same Supabase database. The driver portal must be lightweight, mobile-first, and secure enough to handle financial data (pay statements).

**Tech stack:** Next.js 14+ (App Router), Supabase (Postgres + Auth + Storage), Tailwind CSS, deployed on Vercel. The existing Fleet Portal uses this same stack — the driver portal should feel like a sibling app, not a fork.

**Existing Supabase tables the portal will read from (do NOT recreate these):**
- `drivers` — driver_id (lease number), name, fleet_id, personal_phone_norm, email, drivers_license, active, insert_date, seated_vehicle_number
- `driver_vehicle_assignments` — driver_id, vehicle_number, fleet_id, is_primary
- `vehicles` — vehicle_number, fleet_id, online_status
- `user_profiles` — id, is_admin, offices (for admin access control)

The portal will create its own tables for driver auth, documents, pay statements, announcements, feedback, and accolades. Ask me whenever something is unclear — I'd rather answer a question than redo a feature.

---

## Authentication

Drivers log in with their **Lease Number** (this is `driver_id` in the drivers table, typically a 5-digit number) and a **password**. This is a separate auth system from the Fleet Portal's admin login.

### Requirements:
- First-time setup: driver enters lease number → system verifies it exists in the `drivers` table → driver creates a password and confirms their phone number
- Passwords hashed with bcrypt or Supabase Auth (your call on which is cleaner)
- Session tokens with 24-hour expiry — drivers stay logged in on their phone for a day
- "Forgot password" flow via SMS to their `personal_phone_norm` (Twilio is already configured in the Fleet Portal environment)
- Rate limiting on login attempts (5 failures → 15-minute lockout)
- **Admin impersonation**: Fleet Portal admins should be able to view any driver's portal as that driver (for support), using their existing admin session. Implement a `/admin/impersonate/:driverId` route protected by the admin's Supabase auth

### Database:
```
driver_portal_auth:
  id UUID PK
  driver_id INTEGER UNIQUE (references drivers.driver_id)
  password_hash TEXT NOT NULL
  phone_verified BOOLEAN DEFAULT FALSE
  created_at TIMESTAMPTZ
  last_login TIMESTAMPTZ
  failed_attempts INTEGER DEFAULT 0
  locked_until TIMESTAMPTZ
```

---

## Feature 1: Announcements / News Feed

A news feed on the driver's home page. I (admin) post announcements; drivers see them in reverse chronological order.

### Requirements:
- Admin creates/edits/deletes announcements from a simple editor (title, body in markdown, optional category tag, optional expiration date)
- Announcements can be targeted: all drivers, specific offices, or specific account types (Access, school runs, etc.)
- Drivers see announcements relevant to them (their office + opted-in accounts)
- "Pinned" announcements stick to the top regardless of date
- Read receipts: track which drivers have seen each announcement (small "X of Y drivers viewed" counter for admin)

### Database:
```
announcements:
  id UUID PK
  title TEXT NOT NULL
  body TEXT NOT NULL (markdown)
  category TEXT (general, safety, policy, account-specific)
  target_offices TEXT[] (null = all offices)
  target_accounts TEXT[] (null = all, e.g. ['access', 'school_runs'])
  pinned BOOLEAN DEFAULT FALSE
  expires_at TIMESTAMPTZ
  created_by TEXT
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ

announcement_reads:
  announcement_id UUID REFERENCES announcements
  driver_id INTEGER
  read_at TIMESTAMPTZ
  PRIMARY KEY (announcement_id, driver_id)
```

---

## Feature 2: Driver Profile & Information

Stores extended driver information beyond what the `drivers` table currently holds.

### Requirements:
- Date of birth, hire/start date (may already exist as `insert_date`), emergency contact
- Driver's license number, TLC/permit number, license expiration date
- Associated accounts: Access, Dial-a-Ride, school runs, special accounts — these are opt-in flags
- Preferred communication method: SMS, email, or both
- Preferred language: English, Spanish, Armenian, Farsi, Russian, other
- Profile photo (optional, stored in Supabase Storage)
- Drivers can edit their own profile. Admins can edit any driver's profile.

### Database:
```
driver_profiles:
  driver_id INTEGER PK (references drivers.driver_id)
  date_of_birth DATE
  hire_date DATE
  emergency_contact_name TEXT
  emergency_contact_phone TEXT
  license_number TEXT
  license_expiration DATE
  permit_number TEXT
  permit_expiration DATE
  medical_card_expiration DATE (Access drivers only)
  drug_test_expiration DATE
  preferred_contact TEXT DEFAULT 'sms' (sms, email, both)
  preferred_language TEXT DEFAULT 'en'
  profile_photo_url TEXT
  accounts TEXT[] (array: 'access', 'dial_a_ride', 'school_runs', 'special')
  updated_at TIMESTAMPTZ
```

---

## Feature 3: Document Management

Drivers upload photos/scans of their current documents. Claude Vision parses the images to auto-fill relevant fields.

### Requirements:
- Document types: driver's license, TLC permit, drug test results, medical card (Access drivers)
- Upload flow: driver takes a photo or selects a file → image is stored in Supabase Storage → Claude Vision parses the image to extract fields (name, license number, expiration date, etc.) → extracted fields are shown for driver confirmation → confirmed values update `driver_profiles`
- Document history: keep all uploaded versions (don't overwrite). Show current + previous with timestamps.
- Expiration tracking: the system knows when each document expires based on parsed dates. This feeds into the automated notifications (Feature 5).
- Admin view: admin can see all drivers' documents, filter by "expiring within 30 days," and flag missing documents.

### Claude Vision Integration:
When a driver uploads a document image, call the Anthropic API with the image and a prompt like:
```
This is a photo of a [document_type]. Extract the following fields:
- Full name
- License/permit number
- Issue date
- Expiration date
- State/jurisdiction
- Any restrictions or endorsements

Return as JSON. If a field is not visible or illegible, return null for that field.
```

### Database:
```
driver_documents:
  id UUID PK
  driver_id INTEGER REFERENCES drivers.driver_id
  document_type TEXT NOT NULL (license, permit, drug_test, medical_card)
  file_url TEXT NOT NULL (Supabase Storage path)
  file_name TEXT
  uploaded_at TIMESTAMPTZ
  parsed_data JSONB (Claude's extracted fields)
  confirmed BOOLEAN DEFAULT FALSE
  confirmed_at TIMESTAMPTZ
  expires_at DATE (extracted from document)
  is_current BOOLEAN DEFAULT TRUE
```

---

## Feature 4: Pay Statements

Display historical pay stubs. Data source is **NTS** (the payroll system). I don't have the NTS API details yet — build the UI and data model assuming pay statements will be imported (CSV upload or API sync to be determined).

### Requirements:
- List view of pay statements sorted by date (most recent first)
- Each statement shows: pay period, gross earnings, deductions, net pay
- Click to view full statement detail (line items, trip counts, lease fees, etc.)
- PDF download of individual statements
- **Tax estimation tool**: since drivers are 1099 independent contractors, show a running "estimated tax owed" based on YTD earnings. Use a simple formula: federal (~15.3% self-employment + marginal income tax rate) applied to net earnings after deductions. Show a "recommended weekly set-aside" amount. This does NOT need to be tax advice — frame it as an estimate with a disclaimer.
- Admin can upload pay statement data (CSV with driver_id, pay_period, amounts) until the NTS integration is built

### Security:
- **Row Level Security**: a driver can ONLY see their own pay statements. Enforce at the Supabase RLS level, not just the app level.
- **Audit logging**: log every time a driver views a pay statement (who, when, which record)
- **No caching** of pay statement data in the browser (Cache-Control: no-store)

### Database:
```
pay_statements:
  id UUID PK
  driver_id INTEGER NOT NULL REFERENCES drivers.driver_id
  pay_period_start DATE NOT NULL
  pay_period_end DATE NOT NULL
  gross_earnings NUMERIC(10,2)
  total_deductions NUMERIC(10,2)
  net_pay NUMERIC(10,2)
  line_items JSONB (array of { description, amount, category })
  trip_count INTEGER
  source TEXT DEFAULT 'manual' (manual, nts_api, csv_import)
  imported_at TIMESTAMPTZ
  created_at TIMESTAMPTZ

-- RLS policy: drivers see only their own
ALTER TABLE pay_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_own_statements ON pay_statements
  FOR SELECT USING (driver_id = (SELECT driver_id FROM driver_portal_auth WHERE id = auth.uid()));

pay_statement_access_log:
  id UUID PK
  driver_id INTEGER
  statement_id UUID REFERENCES pay_statements
  accessed_at TIMESTAMPTZ
  ip_address TEXT
```

---

## Feature 5: Automated Notifications

Drivers receive automated messages on key dates. Uses the existing Twilio integration.

### Requirements:
- **Birthday**: automated "Happy Birthday" message on the driver's DOB. Respect preferred language.
- **Driving anniversary**: message on the anniversary of their hire date. Include milestone recognition (1 year, 5 years, 10 years, etc.)
- **Document expiration warnings**: 60 days, 30 days, 14 days, and 7 days before a document expires. Escalate urgency in tone. If the document expires, send a final "your [document] has expired" notice.
- **Delivery method**: based on driver's `preferred_contact` setting — SMS (via Twilio), email, or both
- **Admin dashboard**: show upcoming birthdays, anniversaries, and expiring documents for the next 30 days. Let admin manually trigger a message.
- **Cron schedule**: daily job at 8 AM Pacific that checks all triggers and sends messages

### Database:
```
notification_log:
  id UUID PK
  driver_id INTEGER
  notification_type TEXT (birthday, anniversary, doc_expiring, doc_expired, custom)
  channel TEXT (sms, email)
  message_text TEXT
  sent_at TIMESTAMPTZ
  success BOOLEAN
  error TEXT
```

---

## Feature 6: Feedback System

Drivers can submit feedback about the fleet, company, portal, etc.

### Requirements:
- Simple form: category dropdown (vehicle condition, company policy, portal feedback, safety concern, other) + free-text body + optional anonymous flag
- Admin sees all feedback in a list, can filter by category, mark as read, reply (reply goes via driver's preferred contact method)
- Anonymous feedback hides the driver's identity from the admin view (but is stored in the DB for abuse prevention)
- Feedback can include a photo attachment (stored in Supabase Storage)

### Database:
```
driver_feedback:
  id UUID PK
  driver_id INTEGER REFERENCES drivers.driver_id
  anonymous BOOLEAN DEFAULT FALSE
  category TEXT NOT NULL
  body TEXT NOT NULL
  photo_url TEXT
  admin_read BOOLEAN DEFAULT FALSE
  admin_reply TEXT
  admin_replied_at TIMESTAMPTZ
  admin_replied_by TEXT
  created_at TIMESTAMPTZ
```

---

## Feature 7: Accolades & Milestones

Badges/achievements that appear on the driver's profile.

### Requirements:
- Automatic accolades based on data: X trips completed, Y years driving, Z consecutive months active
- Admin-granted accolades: "Driver of the Month," "Safety Award," custom awards
- Display on the driver's profile as badges with name, icon, and date earned
- Milestone thresholds (configurable by admin): 1000 trips, 5000 trips, 10000 trips; 1 year, 3 years, 5 years, 10 years, etc.

### Database:
```
accolade_types:
  id UUID PK
  name TEXT NOT NULL (e.g. "1000 Trips", "5 Year Veteran", "Driver of the Month")
  description TEXT
  icon TEXT (emoji or icon name)
  auto_trigger JSONB (null = manual only, e.g. { "metric": "trips", "threshold": 1000 })
  created_at TIMESTAMPTZ

driver_accolades:
  id UUID PK
  driver_id INTEGER REFERENCES drivers.driver_id
  accolade_type_id UUID REFERENCES accolade_types
  awarded_at TIMESTAMPTZ
  awarded_by TEXT (system, admin email, etc.)
  note TEXT
```

---

## Feature 8: Account Opt-In & Account Admins

Drivers opt in to receive alerts about specific account types. Admin can delegate account management to colleagues.

### Requirements:
- Account types: Access (paratransit), School Runs, Dial-a-Ride, Special Accounts (custom)
- Drivers toggle which accounts they want alerts for in their profile
- When I (or an account admin) post an announcement targeted at an account, only opted-in drivers see it
- Account admin delegation: I can assign a colleague (by email) as the admin of a specific account type. That person can then post announcements and view drivers for that account, but NOT access other admin features.
- Account admins see a filtered view: only their account's drivers, announcements, and feedback.

### Database:
```
account_admins:
  id UUID PK
  account_type TEXT NOT NULL (access, school_runs, dial_a_ride, special)
  admin_email TEXT NOT NULL
  admin_name TEXT
  granted_by TEXT
  granted_at TIMESTAMPTZ
  UNIQUE (account_type, admin_email)
```

---

## Integrations (Future — Build the Hooks Now)

### NTS (Payroll)
The pay statement data will eventually come from NTS. I don't have API details yet. For now:
- Build a CSV upload endpoint for pay statement import (admin only)
- Design the `pay_statements` table to accommodate both manual imports and future API sync
- Add a `source` field so we can distinguish manual vs. automated records
- Leave a placeholder service file (`lib/nts.ts`) with a `syncPayStatements()` function that currently returns "not configured"

### DocuWare (Document Management)
DocuWare may be used for document storage/retrieval. I don't have API details yet. For now:
- Documents are stored in Supabase Storage
- Leave a placeholder service file (`lib/docuware.ts`) with hooks for `uploadDocument()` and `fetchDocuments()` that currently use Supabase Storage directly
- When DocuWare is integrated, these functions would call DocuWare's API instead

---

## Infrastructure & Security Requirements

### Performance Target:
- Must handle 1000 concurrent users (drivers checking pay statements at the same time)
- Use Supabase connection pooling (pgBouncer, enabled on Supabase Pro plan)
- Cache static content aggressively (announcements, accolade types)
- Pay statements: no browser caching (financial data), but server-side caching of the list query is fine with a short TTL

### Security:
- HTTPS everywhere (Vercel default)
- Row Level Security on ALL tables containing driver-specific data
- Pay statement access logging (every view logged)
- Passwords hashed with bcrypt (minimum 12 rounds)
- Session tokens are httpOnly, secure, sameSite cookies
- CSRF protection on all mutations
- Input sanitization — drivers upload images (potential XSS via filenames, EXIF data)
- File upload limits: 10MB per image, images only (JPEG, PNG, HEIC)
- Rate limiting: 100 requests/minute per driver session
- Admin impersonation must be logged in an audit trail

### Mobile-First Design:
- 90%+ of drivers will use this on their phone
- Touch-friendly buttons (minimum 44px tap targets)
- Fast load times — aim for <2s First Contentful Paint on 4G
- Offline-friendly where possible (at minimum, show cached announcements)
- Camera integration for document uploads (use `<input type="file" accept="image/*" capture="environment">`)

---

## Project Structure

```
driver-portal/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── setup/page.tsx          # first-time password creation
│   ├── (portal)/
│   │   ├── layout.tsx              # authenticated layout with nav
│   │   ├── page.tsx                # home — announcements feed
│   │   ├── profile/page.tsx
│   │   ├── documents/page.tsx
│   │   ├── pay/page.tsx
│   │   ├── feedback/page.tsx
│   │   └── accolades/page.tsx
│   ├── admin/
│   │   ├── announcements/page.tsx
│   │   ├── drivers/page.tsx
│   │   ├── documents/page.tsx      # expiring docs dashboard
│   │   ├── pay/upload/page.tsx
│   │   ├── feedback/page.tsx
│   │   ├── accounts/page.tsx       # account admin delegation
│   │   └── impersonate/[id]/page.tsx
│   └── api/
│       ├── auth/login/route.ts
│       ├── auth/setup/route.ts
│       ├── auth/forgot/route.ts
│       ├── announcements/route.ts
│       ├── profile/route.ts
│       ├── documents/route.ts
│       ├── documents/parse/route.ts  # Claude Vision endpoint
│       ├── pay/route.ts
│       ├── pay/import/route.ts
│       ├── feedback/route.ts
│       ├── accolades/route.ts
│       ├── notifications/cron/route.ts
│       └── admin/[...]/route.ts
├── lib/
│   ├── supabase/                   # reuse same Supabase client pattern
│   ├── twilio.ts                   # reuse existing Twilio send helper
│   ├── nts.ts                      # placeholder for NTS integration
│   ├── docuware.ts                 # placeholder for DocuWare integration
│   └── tax-estimator.ts            # 1099 tax estimation logic
├── components/
├── supabase/migrations/            # driver portal specific tables
└── package.json
```

---

## Implementation Order

Please implement in this order, showing me each feature before moving on:

1. **Project scaffold + Auth** — login, first-time setup, session management, admin impersonation
2. **Driver Profile** — profile page, edit form, account opt-ins
3. **Announcements** — admin CRUD, driver feed, read tracking, targeting
4. **Document Management** — upload, Claude Vision parsing, expiration tracking, admin dashboard
5. **Pay Statements** — CSV import, list/detail views, PDF download, tax estimator
6. **Notifications** — cron job, birthday/anniversary/expiration messages
7. **Feedback** — submit form, admin list, reply flow
8. **Accolades** — badge definitions, auto-triggers, profile display
9. **Account Admins** — delegation UI, filtered views

Ask me questions whenever you're uncertain. I'd rather clarify upfront than rebuild.
