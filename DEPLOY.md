# Deployment Guide — Git + Vercel (no more zips)

## One-time setup

### 1. Create a GitHub repo
Go to github.com → New repository → Name it `fleet-portal` → Private → Create

### 2. Initialize Git in your project folder
Open terminal in your fleet-portal folder and run:

```bash
git init
git add .
git commit -m "Initial fleet portal"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/fleet-portal.git
git push -u origin main
```

### 3. Connect Vercel to GitHub
- Go to vercel.com → Add New Project → Import from GitHub → select fleet-portal
- Add all environment variables from .env.local
- Deploy

Vercel will now auto-deploy every time you push to main.

---

## Applying future updates from Claude

When Claude provides updated files, simply replace them in your folder and run:

```bash
git add .
git commit -m "describe the update"
git push
```

Vercel detects the push and deploys automatically in ~60 seconds.
No zip files. No manual uploads.

---

## For this v1.7 update specifically

### Files to replace:
- app/(app)/audit/page.tsx
- app/(app)/devices/page.tsx
- app/(app)/lines/page.tsx
- app/(app)/vehicles/page.tsx
- app/(app)/update-db/page.tsx
- app/api/import/route.ts
- components/VehiclePanel.tsx
- components/VehiclesTable.tsx
- components/Sidebar.tsx
- components/UsageMeter.tsx
- supabase/migrations/005_fix_duplicates.sql  ← run in Supabase SQL Editor

### Run in Supabase SQL Editor FIRST:
Copy and run supabase/migrations/005_fix_duplicates.sql

### Then push:
```bash
git add .
git commit -m "v1.7 - fixes and improvements"
git push
```
