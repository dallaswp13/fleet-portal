# Fleet Portal

Multi-user taxi fleet management portal built with **Next.js 15**, **Supabase**, and deployed on **Vercel**.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router, TypeScript) |
| Backend/DB | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | Vercel |
| Source control | GitHub → Vercel CI/CD |
| Device management | IBM MaaS360 API |
| Wireless | Verizon Business (ThingSpace) API |

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — fleet stats + recent actions |
| `/vehicles` | All vehicles — search, filter, click to manage |
| `/devices` | MaaS360 device inventory |
| `/lines` | Verizon SIM cards + usage |
| `/audit` | Full action audit log |

---

## One-time Setup

### 1. Clone & install

```bash
git clone https://github.com/your-org/fleet-portal.git
cd fleet-portal
npm install
```

### 2. Supabase project

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the full contents of:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. Copy your project URL and keys from **Settings → API**

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in all values in `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# IBM MaaS360 (from your MaaS360 admin portal)
MAAS360_BASE_URL=https://services.fiberlink.com
MAAS360_BILLING_ID=your-billing-id
MAAS360_PLATFORM_ID=3
MAAS360_APP_ID=your-app-id
MAAS360_APP_VERSION=1.0
MAAS360_APP_ACCESS_KEY=your-app-access-key
MAAS360_USERNAME=your-username
MAAS360_PASSWORD=your-password

# Verizon ThingSpace (from developer.verizon.com)
VERIZON_BASE_URL=https://thingspace.verizon.com/api
VERIZON_CLIENT_ID=your-client-id
VERIZON_CLIENT_SECRET=your-client-secret
VERIZON_ACCOUNT_NAME=your-account-name
```

### 4. Create admin user

In Supabase Dashboard → **Authentication → Users → Add user**:
- Enter email + password for your admin account

### 5. Import fleet data

Copy your source files into the `data/` folder:

```
data/
  CCSI.xlsx
  View_All_Devices.csv
  account_unbilled_usage_report.csv
```

Install Python dependencies and run the import:

```bash
pip install supabase openpyxl pandas python-dotenv
python scripts/import_data.py --all
```

This will:
1. Import all vehicles from CCSI.xlsx (Active, Test, Surrenders tabs)
2. Import all MaaS360 devices from View_All_Devices.csv
3. Import all Verizon lines from the usage report
4. Link records together by phone number

### 6. Run locally

```bash
npm run dev
# → http://localhost:3000
```

---

## Deploy to Vercel

### Connect GitHub

1. Push to GitHub:
   ```bash
   git add .
   git commit -m "Initial fleet portal"
   git push origin main
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your GitHub repo

3. Add all environment variables from `.env.local` in Vercel's **Environment Variables** settings

4. Deploy — Vercel auto-deploys on every push to `main`

---

## IBM MaaS360 API — Device Actions

Actions are sent via **POST /api/maas360/action** with JSON body:

| Field | Type | Required |
|-------|------|----------|
| `action` | `reboot \| wipe \| kiosk_enter \| kiosk_exit \| clear_app_data` | Yes |
| `deviceId` | string (MaaS360 Device ID) | Yes |
| `vehicleNumber` | number | No |
| `confirmed` | boolean (required for `wipe`) | Conditional |

All actions are logged in `audit_log`.

**MaaS360 credentials:** Obtain from your MaaS360 Admin Portal under **Setup → API Access**.
Reference: [MaaS360 API Docs](https://help.hcltechsw.com/maas360/en_us/apidocs.html)

---

## Verizon API — Activate SIM

Action is sent via **POST /api/verizon/activate** with JSON body:

| Field | Type | Required |
|-------|------|----------|
| `phoneNumber` | string (10-digit) | Yes |
| `iccid` | string | No |
| `accountNumber` | string | No |
| `vehicleNumber` | number | No |

**Verizon credentials:** Register at [ThingSpace Developer Portal](https://thingspace.verizon.com).
Reference: [ThingSpace API Docs](https://thingspace.verizon.com/documentation/)

---

## Database Tables

| Table | Description |
|-------|-------------|
| `vehicles` | Core fleet record per cab (from CCSI.xlsx) |
| `devices` | MaaS360 tablet inventory |
| `verizon_lines` | Verizon SIM/usage data |
| `audit_log` | All portal actions with user, timestamp, result |
| `fleet_overview` | View joining all three tables by vehicle |

---

## Re-importing Data

Re-run the import script at any time — it uses **upsert** (update if exists, insert if new):

```bash
python scripts/import_data.py --ccsi      # CCSI only
python scripts/import_data.py --devices   # MaaS360 only
python scripts/import_data.py --verizon   # Verizon only
python scripts/import_data.py --all       # Everything
```

---

## Project Structure

```
fleet-portal/
├── app/
│   ├── (app)/              # Authenticated routes
│   │   ├── page.tsx        # Dashboard
│   │   ├── vehicles/       # Vehicle list + actions
│   │   ├── devices/        # MaaS360 devices
│   │   ├── lines/          # Verizon lines
│   │   └── audit/          # Audit log
│   ├── api/
│   │   ├── maas360/action/ # MaaS360 device action API
│   │   └── verizon/activate/ # Verizon SIM activate API
│   ├── login/              # Login page
│   └── globals.css
├── components/
│   ├── Sidebar.tsx         # Navigation
│   ├── VehiclePanel.tsx    # Vehicle detail + action modal
│   └── VehiclesTable.tsx   # Sortable/searchable table
├── lib/
│   ├── maas360.ts          # IBM MaaS360 API client
│   ├── verizon.ts          # Verizon API client
│   ├── audit.ts            # Audit log helper
│   └── supabase/           # Supabase client (browser + server)
├── scripts/
│   └── import_data.py      # Data seeding script
├── supabase/migrations/    # SQL schema
├── types/index.ts          # TypeScript types
└── middleware.ts           # Auth protection
```
