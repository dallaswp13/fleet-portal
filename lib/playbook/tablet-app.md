# Tablet / Dispatch App Issues

> ~15% of all incoming support requests.

## What Is Happening

The driver tablet (front-seat, dashboard-mounted) runs the **Dispatch app** — our main in-tablet app. Issues in this category involve the tablet itself or the Dispatch app — NOT the PIM (back-seat) and NOT the meter.

> **DriveMate is NOT the Dispatch app.** DriveMate is a separate app that we do NOT support. Never call the Dispatch app "DriveMate." If a driver asks for help with DriveMate, tell them you can't help with DriveMate; if they still need help they can come to the office in person during office hours.

## Sub-Types

### Can't Sign In / Login Failure
Driver can't log into the Dispatch app. May see "unable to contact dispatch" message.
- **Driver says:** "can't sign in," "can't log in," "unable to contact dispatch," "won't let me sign on"
- **Action:** `reboot_driver`
- **Note:** If the tablet shows "car registration expired" — this is an account/profile issue (see account-profile.md), not a tablet issue. Don't reboot; it needs a backend update.

### App Crash / Freeze
The Dispatch app closes unexpectedly or the tablet becomes unresponsive.
- **Driver says:** "app has been crash," "app closes," "tablet frozen," "tablet not responding," "Dispatch app not working"
- **Action:** `reboot_driver`
- **Escalation:** If a reboot doesn't fix it, tell the driver to come to the office in person during office hours. (There is no remote app-data clear — never tell the driver you cleared anything.)

### Tablet Dark / Blank / Wrong Screen
Screen is black, very dim, or showing the Android home screen instead of the Dispatch app.
- **Driver says:** "tablet gone dark," "screen is blank," "tablet shows bunch of apps," "steady blue color," "faint screen"
- **Action:** First ask driver to hold power button for 10 seconds (hard restart). If that doesn't work, `reboot_driver`
- **Note:** If the screen is extremely faint but shows the power menu, it's likely a brightness/backlight issue — walk them through Settings → Display → Brightness

### Tablet Needs Full Reset
Driver has tried restarting but the problem persists. Tablet may be in a bad state.
- **Driver says:** "I already tried restarting," "reset didn't work," "still the same after reboot"
- **Action:** If a reboot has already been tried and failed, escalate — set `needs_human` — and tell the driver to come to the office in person during office hours. Do NOT promise a remote reset or app-data clear; those aren't available.
- **Escalation:** Office visit for possible re-imaging or device swap

## Resolution Flow

```
1. Driver reports tablet / Dispatch app issue
   ├─ Can you identify the cab number?
   │   ├─ YES → Send reboot_driver
   │   └─ NO → Ask for cab number
   │
2. Still not working after reboot
   └─ Tell the driver to come to the office in person during office hours.
      Do NOT claim you cleared app data or did a remote reset, and do NOT say anyone will contact them.
```

## Response Templates

**English — First contact:**
"Sending a reboot to your tablet now (cab {vehicle_number}). Give it about 3 minutes to restart and try signing in again."

**English — After reboot failed:**
"Thanks for trying that. If it's still not working, please bring the cab to the office in person during office hours and we'll take a hands-on look."

**English — DriveMate request:**
"Sorry, I'm not able to help with DriveMate. If you need help, you can come to the office in person during office hours."

**Spanish — First contact:**
"Enviando reinicio a la tableta del taxi {vehicle_number}. Dale unos 3 minutos para que reinicie e intenta conectarte de nuevo."

**Spanish — After reboot failed:**
"Si sigue sin funcionar, por favor trae el taxi a la oficina en persona durante el horario de oficina y lo revisamos."

## Common Misspellings
- "teblet" / "tablt" / "tabled" — tablet
- "sing in" / "sine in" — sign in
- "dispach" / "dispatcher" — Dispatch app
