# Connectivity / Network Issues

> ~5% of all incoming support requests.

## What Is Happening

The driver tablet relies on a cellular data connection (Verizon SIM) for dispatch, GPS, and Uber. When cellular or GPS drops, the tablet can't receive calls, show zones, or navigate.

## Sub-Types

### Cellular Network Unreachable
Tablet can't connect to mobile data. No dispatch, no Uber, no calls.
- **Driver says:** "cellular network not reachable," "can't post or receive calls," "no signal," "I'm not getting signal"
- **Action:** Ask driver to restart the tablet first (power button hold). If they've already tried → `reboot_driver`
- **Escalation:** If persistent, may be a Verizon SIM issue — check line status in Fleet Portal

### GPS Red / No GPS
Location services not working. Tablet can't show zones or navigate.
- **Driver says:** "GPS is red," "no GPS," "zones not showing," "GPS slow picking up address," "mi tablet no tiene GPS"
- **Action:** `reboot_driver`
- **Note:** GPS issues sometimes resolve on their own once the tablet gets a clear sky view. If driver is in a parking garage or underground, that's the cause.

### Intermittent Connectivity
Connection works then drops repeatedly. One driver reported it happening daily around 6 PM.
- **Driver says:** "the app goes off for a minute," "keeps going on and off," "connection drops during rides"
- **Action:** `reboot_driver`
- **Note:** If multiple drivers report drops at the same time, it's likely a server-side or carrier issue, not device-level. Flag for Dallas.

## Resolution Flow

```
1. Driver reports connectivity issue
   ├─ Ask: "Have you tried turning the tablet off and back on?"
   │   ├─ YES (or already tried) → Send reboot_driver
   │   └─ NO → Ask them to try first
   │
2. Still no connection after reboot
   ├─ Check if other drivers in same area have issues (system-wide?)
   ├─ If isolated: may be a SIM card issue → office visit to swap SIM
   │
3. GPS specifically
   ├─ Ask: "Are you in a parking garage or underground? GPS needs open sky."
   └─ If no → reboot_driver, then office visit if persistent
```

## Response Templates

**English — First contact:**
"Try turning the tablet completely off (hold power button 10 seconds), wait 30 seconds, then turn it back on. That usually resets the connection. Let me know if it helps."

**English — After self-fix failed:**
"Sending a remote reboot now (cab {vehicle_number}). If it still can't connect after that, the SIM card might need to be checked at the office."

**Spanish — First contact:**
"Intenta apagar la tableta completamente (mantén el botón de encendido 10 segundos), espera 30 segundos y vuélvela a encender. Avísame si funciona."
