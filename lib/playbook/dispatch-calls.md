# Dispatch / Call Issues

> ~3% of all incoming support requests.

## What Is Happening

The dispatch system sends ride offers (bids) to driver tablets. When drivers don't receive bids, can't accept them, or experience sound/notification problems, they're losing fares.

## Sub-Types

### Not Receiving Bids / Calls
Tablet appears active but no ride offers come through.
- **Driver says:** "not receiving any calls," "no bids," "tablet not receiving any bids from Yellow," "didn't receive any call at all"
- **Action:** `reboot_driver`
- **Note:** If multiple drivers report this simultaneously, it's a dispatch server issue — flag immediately.

### Call Drops on Accept
Driver taps "Accept" on a ride offer but the ride doesn't open.
- **Driver says:** "I press accept and it doesn't open the ride," "call drops when I accept," "ride disappears"
- **Action:** `reboot_driver` → `clear_dispatch` if persists

### Duplicate Dispatch
Two drivers get sent to the same passenger.
- **Driver says:** "other drivers picking up my call," "two people dispatched the same call"
- **Action:** This is a dispatch server issue, not device-level. Acknowledge and escalate.
- **Reply:** "That sounds like a dispatch routing issue. I'll flag it for the team to look into."

### Sound / Notification Missing
No audible alert when a ride offer arrives. Driver misses bids.
- **Driver says:** "no sound on tablet," "no ping when ride comes through," "I can see the call but no sound"
- **Action:** Walk driver through Settings → Sound → make sure it's on "Sound" not "Vibrate." Check Do Not Disturb is off.
- **Self-service fix:** "Go to Settings → Sound on your tablet and make sure it's set to Sound, not Vibrate. Also check that Do Not Disturb is turned off."

## Resolution Flow

```
1. Not receiving calls
   ├─ reboot_driver
   ├─ If one driver: device issue
   ├─ If multiple: system issue → escalate
   │
2. Sound issues
   ├─ Walk through self-service settings check first
   ├─ If settings are correct → reboot_driver
   │
3. Duplicate dispatch
   └─ Acknowledge + escalate (not device-fixable)
```

## Response Templates

**English — No calls:**
"Sending a reboot to refresh your dispatch connection (cab {vehicle_number}). Give it a few minutes and the bids should start coming through."

**English — Sound issue:**
"Check your tablet's sound settings: go to Settings → Sound and make sure it's set to 'Sound' (not 'Vibrate'). Also make sure Do Not Disturb is off. Let me know if that fixes it."

**Spanish — No calls:**
"Reiniciando tu tableta para refrescar la conexión de despacho (taxi {vehicle_number}). Los viajes deberían empezar a llegar en unos minutos."
