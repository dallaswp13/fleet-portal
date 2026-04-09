@echo off
echo Clearing git locks...
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul

echo Committing all pending changes...
git -c user.email="dplumley@layellowcab.com" -c user.name="Dallas Plumley" add lib/supabase/server.ts app/set-password/page.tsx app/api/admin/invite/route.ts "app/(app)/vehicles/page.tsx" "app/(app)/devices/page.tsx" "app/(app)/lines/page.tsx" "app/(app)/layout.tsx" components/UserManager.tsx components/OfficeFilter.tsx lib/maas360.ts app/api/maas360/keepalive/route.ts vercel.json
git -c user.email="dplumley@layellowcab.com" -c user.name="Dallas Plumley" commit -m "fix: RLS bypass, null offices = no access, scoped office filter, green User pill, MaaS360 auth fixes + keepalive cron"

echo Pushing to live site...
git push origin main

echo Done! Press any key to close.
pause
