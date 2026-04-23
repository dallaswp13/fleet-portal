# Tablet / App Issues

> ~15% of all incoming support requests.

## What Is Happening

The driver tablet (front-seat, dashboard-mounted) runs the DriveMate dispatch app. Issues in this category involve the tablet itself or the DriveMate app — NOT the PIM (back-seat) and NOT the meter.

## Sub-Types

### Can't Sign In / Login Failure
Driver can't log into the DriveMate app. May see "unable to contact dispatch" message.
- **Driver says:** "can't sign in," "can't log in," "unable to contact dispatch," "won't let me sign on"
- **Action:** `reboot_driver`
- **Note:** If the tablet shows "car registration expired" — this is an account/profile issue (see account-profile.md), not a tablet issue. Don't reboot; it needs a backend update.

### App Crash / Freeze
DriveMate closes unexpectedly or tablet becomes unresponsive.
- **Driver says:** "app has been crash," "app closes," "tablet frozen," "tablet not responding," "DriveMate not working"
- **Action:** `reboot_driver` → if persists, `clear_dispatch` (clear DriveMate app data)
- **Escalation:** If clearing app data doesn't fix it, suggest office visit

### Tablet Dark / Blank / Wrong Screen
Screen is black, very dim, or showing Android home screen instead of DriveMate.
- **Driver says:** "tablet gone dark," "screen is blank," "tablet shows bunch of apps," "steady blue color," "faint screen"
- **Action:** First ask driver to hold power button for 10 seconds (hard restart). If that doesn't work, `reboot_driver`
- **Note:** If the screen is extremely faint but shows the power menu, it's likely a brightness/backlight issue — walk them through Settings → Display → Brightness

### Tablet Needs Full Reset
Driver has tried restarting but the problem persists. Tablet may be in a bad state.
- **Driver says:** "I already tried restarting," "reset didn't work," "still the same after reboot"
- **Action:** `clear_dispatch` (clears DriveMate app data and forces re-login)
- **Escalation:** If clearing app data fails → office visit for possible re-imaging or device swap

## Resolution Flow

```
1. Driver reports tablet/app issue
   ├─ Can you identify the cab number?
   │   ├─ YES → Send reboot_driver
   │   └─ NO → Ask for cab number
   │
2. Still not working after reboot
   ├─ Send clear_dispatch (clears DriveMate app data)
   ├─ Reply: "Cleared the app data. You'll need to sign in again when it comes back up."
   │
3. Still not working after app data clear
   └─ Suggest office visit for device inspection
```

## Response Templates

**English — First contact:**
"Sending a reboot to your tablet now (cab {vehicle_number}). Give it about 3 minutes to restart and try signing in again."

**English — After reboot failed:**
"Let me clear the DriveMate app data. It'll take a minute, and you'll need to sign back in when it comes up."

**English — Escalation:**
"Sounds like the tablet might need to be looked at in person. Can you bring the cab by the office?"

**Spanish — First contact:**
"Enviando reinicio a la tableta del taxi {vehicle_number}. Dale unos 3 minutos para que reinicie e intenta conectarte de nuevo."

**Spanish — Escalation:**
"Parece que la tableta necesita revisión en persona. ¿Puedes pasar por la oficina?"

## Common Misspellings
- "teblet" / "tablt" / "tabled" — tablet
- "sing in" / "sine in" — sign in
- "dispach" — dispatch
- "drive mate" / "drivermate" / "driver mate" — DriveMate
