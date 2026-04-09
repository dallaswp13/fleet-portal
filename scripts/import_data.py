#!/usr/bin/env python3
"""
Fleet Portal — Data Import Script
Drop the three source files into data/ and run --all at any time to refresh.

Usage:
  python -m pip install openpyxl pandas python-dotenv requests
  python scripts/import_data.py --all
"""

import os, sys, re, json, argparse
from pathlib import Path
import requests, pandas as pd, openpyxl
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env.local')

SUPABASE_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
}

CONFLICT_COLS = {
    'vehicles':      'vehicle_number,fleet_id',
    'devices':       'm360_device_id',
    'verizon_lines': 'phone_number',
}

DATA_DIR     = Path(__file__).parent.parent / 'data'
CCSI_FILE    = DATA_DIR / 'CCSI.xlsx'
DEVICES_FILE = DATA_DIR / 'View_All_Devices.csv'
VERIZON_FILE = DATA_DIR / 'account_unbilled_usage_report.csv'

CCSI_SHEETS = {
    'Active Vehicles': 'Active Vehicles',
    'Test Vehicles':   'Test Vehicles',
    'Surrenders':      'Surrenders',
}

def digits_only(s):
    if not s: return ''
    return re.sub(r'\D', '', str(s))

def upsert(table, records):
    url    = f'{SUPABASE_URL}/rest/v1/{table}'
    params = {'on_conflict': CONFLICT_COLS[table]}
    res    = requests.post(url, headers=HEADERS, params=params, data=json.dumps(records))
    if res.status_code not in (200, 201):
        print(f'  ERROR upserting {table}: {res.status_code} {res.text[:300]}')
        sys.exit(1)

def batch_upsert(table, records, batch_size=200):
    for i in range(0, len(records), batch_size):
        upsert(table, records[i:i+batch_size])
        print(f'    {min(i+batch_size, len(records))} / {len(records)}', end='\r')
    print()

def clean(val):
    if val is None: return None
    s = str(val).strip()
    return None if s in ('', ' ', 'nan', 'None', 'N/A', 'NaN') else s

def norm_phone(phone):
    """Normalize to 10 digits, stripping leading country code 1."""
    d = digits_only(phone)
    if len(d) == 11 and d[0] == '1':
        d = d[1:]
    return d if len(d) >= 10 else None

# ─── CCSI ─────────────────────────────────────────────────────────────────────
def import_ccsi():
    print('\n── Importing CCSI.xlsx ──')
    if not CCSI_FILE.exists():
        print(f'  ERROR: {CCSI_FILE} not found.'); return

    wb = openpyxl.load_workbook(CCSI_FILE, data_only=True)
    total = 0

    for sheet_name, tab_label in CCSI_SHEETS.items():
        if sheet_name not in wb.sheetnames:
            print(f'  Sheet "{sheet_name}" not found, skipping'); continue

        ws   = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows: continue

        header = [str(h).strip() if h else '' for h in rows[0]]
        col    = {name: i for i, name in enumerate(header)}

        def g(row, key):
            idx = col.get(key)
            return clean(row[idx]) if idx is not None and idx < len(row) else None

        seen = {}
        for row in rows[1:]:
            vnum = g(row, 'Vehicle #')
            if vnum is None: continue
            try: vnum = int(float(vnum))
            except: continue

            fleet = clean(g(row, 'Fleet ID')) or ''
            dp    = g(row, 'Driver Tablet Phone Number')
            pp    = g(row, 'PIM Phone Number')

            seen[(vnum, fleet)] = {
                'vehicle_number':               vnum,
                'fleet_id':                     fleet,
                'sheet_tab':                    tab_label,
                'driver_app_version':           g(row, 'Driver App Version'),
                'pim_app_version':              g(row, 'PIM App Version'),
                'online_status':                g(row, 'Online Status'),
                'driver_tablet_bluetooth_addr': g(row, 'Driver Tablet Bluetooth Address'),
                'meter_status':                 g(row, 'Meter Status'),
                'driver_tablet_phone_number':   dp,
                'pim_phone_number':             pp,
                'rfid':                         g(row, 'RFID'),
                'meter_bluetooth_name':         g(row, '(Meter) Bluetooth Name'),
                'office':                       None,  # Set by DB trigger
                'driver_phone_norm':            norm_phone(dp),
                'pim_phone_norm':               norm_phone(pp),
            }

        records = list(seen.values())
        if records:
            print(f'  {sheet_name}: {len(records)} records')
            batch_upsert('vehicles', records)
            total += len(records)

    print(f'  Total vehicles: {total}')

# ─── DEVICES ──────────────────────────────────────────────────────────────────
def import_devices():
    print('\n── Importing View_All_Devices.csv ──')
    if not DEVICES_FILE.exists():
        print(f'  ERROR: {DEVICES_FILE} not found.'); return

    df = pd.read_csv(DEVICES_FILE, dtype=str, keep_default_na=False)
    df = df.where(df != '', other=None).where(df.notna(), other=None)

    seen = {}
    for _, row in df.iterrows():
        m360_id = clean(row.get('Device ID'))
        if not m360_id: continue

        imei_raw = row.get('IMEI/MEID')
        imei = None
        if imei_raw and str(imei_raw).strip() not in ('', 'nan', 'None'):
            try:    imei = str(int(float(str(imei_raw))))
            except: imei = clean(str(imei_raw))

        user = clean(row.get('Username'))
        seen[m360_id] = {
            'm360_device_id':    m360_id,
            'device_name':       clean(row.get('Device Name')),
            'm360_user':         user,
            'm360_user_norm':    digits_only(user),
            'tablet_model':      clean(row.get('Model')),
            'android_os':        clean(row.get('Operating System')),
            'imei':              imei,
            'm360_policy':       clean(row.get('MDM Policy')),
            'compliance_status': clean(row.get('Compliance Status')),
            'last_reported':     clean(row.get('Last Reported')),
        }

    records = list(seen.values())
    print(f'  {len(records)} records')
    batch_upsert('devices', records)

# ─── VERIZON ──────────────────────────────────────────────────────────────────
def import_verizon():
    print('\n── Importing account_unbilled_usage_report.csv ──')
    if not VERIZON_FILE.exists():
        print(f'  ERROR: {VERIZON_FILE} not found.'); return

    df = pd.read_csv(VERIZON_FILE, dtype=str, keep_default_na=False)
    df = df.where(df != '', other=None).where(df.notna(), other=None)

    seen = {}
    for _, row in df.iterrows():
        raw   = clean(row.get('Wireless number'))
        phone = norm_phone(raw)
        if not phone: continue

        usage = None
        try: usage = float(str(row.get('Domestic GB', '')).strip())
        except: pass

        seen[phone] = {
            'phone_number':     phone,
            'phone_norm':       digits_only(phone),
            'sub_account':      clean(row.get('Account name')),
            'account_number':   clean(row.get('Account number')),
            'phone_status':     clean(row.get('Wireless number status')),
            'verizon_user':     clean(row.get('User name')),
            'mobile_plan':      clean(row.get('Price plan description')),
            'monthly_usage_gb': usage,
        }

    records = list(seen.values())
    print(f'  {len(records)} records')
    batch_upsert('verizon_lines', records)

# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all',     action='store_true')
    parser.add_argument('--ccsi',    action='store_true')
    parser.add_argument('--devices', action='store_true')
    parser.add_argument('--verizon', action='store_true')
    args = parser.parse_args()

    if not any(vars(args).values()):
        parser.print_help(); sys.exit(1)

    if args.all or args.ccsi:    import_ccsi()
    if args.all or args.devices: import_devices()
    if args.all or args.verizon: import_verizon()

    print('\n✓ Done')

if __name__ == '__main__':
    main()
