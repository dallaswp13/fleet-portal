# Uber / Rideshare Integration

> ~7% of all incoming support requests. Growing in 2026.

## What Is Happening

Yellow Cab drivers can receive Uber ride requests through their dispatch tablet. The Uber integration runs as part of the DriveMate app. When it fails, drivers lose access to Uber fares — a significant income source.

## Sub-Types

### Uber Toggle Green But No Calls
The Uber indicator shows green (active) but driver isn't receiving any Uber ride requests.
- **Driver says:** "Uber green but no calls," "not receiving any uber calls," "uber is on but nothing comes through," "uber toggle green for 2 days no calls"
- **Action:** `reboot_driver` → if persists, this may be an Uber-side account issue (not fixable via MDM)
- **Note:** This became more common in early 2026. Multiple drivers reporting it simultaneously could indicate a system-wide integration issue — flag for Dallas.

### Uber Offer Failed
Driver receives Uber requests but they fail when accepted.
- **Driver says:** "Uber offer failed message," "uber call comes but fails," "uber says failed"
- **Action:** `reboot_driver`
- **Escalation:** If persistent, may need Uber account re-sync on backend

### Can't Enable Uber / Green Button Won't Turn On
The Uber toggle won't activate at all.
- **Driver says:** "uber green button doesn't turn on," "can't turn on uber," "missing uber settings"
- **Action:** `reboot_driver` → `clear_dispatch` if reboot doesn't help
- **Escalation:** If settings are missing after app data clear, likely needs re-provisioning

### Uber App Separate From Dispatch
Some drivers have standalone Uber driver app issues (separate from the integrated system).
- **Driver says:** "my Uber app is not working" (referring to separate Uber app)
- **Action:** This is outside our MDM scope. Advise driver to contact Uber support directly.

## Resolution Flow

```
1. Driver reports Uber issue
   ├─ Identify cab number
   ├─ Send reboot_driver
   ├─ Reply: "Rebooting your tablet to refresh the Uber connection. Give it a few minutes."
   │
2. Still no Uber calls after reboot
   ├─ Try clear_dispatch
   ├─ Reply: "Cleared the app data. Sign back in and check if the Uber toggle works."
   │
3. Still not working
   ├─ If ONE driver: likely account-level issue → escalate to office
   ├─ If MULTIPLE drivers same day: likely system-wide → flag immediately
```

## Response Templates

**English — First contact:**
"Rebooting your tablet to refresh the Uber connection (cab {vehicle_number}). Give it a few minutes and check if the calls start coming through."

**English — Escalation:**
"If you're still not getting Uber calls after the reboot, this might need to be checked at the office — it could be an account sync issue."

**Spanish — First contact:**
"Reiniciando tu tableta para refrescar la conexión con Uber (taxi {vehicle_number}). Espera unos minutos y revisa si empiezan a llegar llamadas."
