# Meter Issues

> ~8% of all incoming support requests.

## What Is Happening

The fare meter is a separate hardware unit that connects to the driver tablet via Bluetooth. When the Bluetooth connection drops, the meter can't start trips or calculate fares correctly. The driver tablet may show **NOM** (No Meter).

**Important:** The meter is NOT the PIM. Rebooting the PIM won't fix meter issues. The meter connects to the **driver tablet**, so meter issues are resolved by rebooting the driver tablet.

## Sub-Types

### Meter Won't Start Trip
Driver presses "Start Trip" but nothing happens.
- **Driver says:** "meter not working," "can't start trips," "start trip doesn't work," "my meter won't start"
- **Action:** `reboot_driver` (restores Bluetooth connection to meter)

### Meter Shows Wrong Fare / Zero Miles
Fare is significantly lower than expected for the same route, or mileage reads 0.
- **Driver says:** "meter is very slow," "showing 0 miles," "fare is only $23 but it's always $41," "no mileage"
- **Action:** `reboot_driver`
- **Note:** If issue persists after reboot, meter hardware may need calibration at the office

### Meter Goes Off Intermittently (NOM)
Meter cuts out mid-ride, then comes back. Red "NOM" indicator appears periodically.
- **Driver says:** "meter goes off during rides," "NOM keeps appearing," "meter turns off intermittently"
- **Action:** `reboot_driver` → if persists, may be a Bluetooth antenna issue requiring office visit
- **Note:** NOM that appears only when the engine is off is likely a power issue, not Bluetooth

### Trip Code Not Working
Driver can't input trip codes for pre-booked or dispatch rides.
- **Driver says:** "trip code doesn't work," "can't input numbers," "trip code not showing"
- **Action:** `reboot_driver`

## Resolution Flow

```
1. Driver reports meter issue
   ├─ Identify cab number
   ├─ Send reboot_driver (this restores the BT connection to the meter)
   ├─ Reply: "Rebooting your tablet to reset the meter connection. Give it 3 minutes."
   │
2. Still not working after reboot
   ├─ Ask: "After it restarts, check if the AOK light is green. If NOM is still red, the meter may need to be looked at in person."
   │
3. Persistent issue
   └─ Office visit — likely Bluetooth antenna or meter hardware
```

## Response Templates

**English — First contact:**
"Rebooting your tablet to reset the meter connection (cab {vehicle_number}). Should take about 3 minutes. Let me know if it comes back."

**English — After reboot failed:**
"When it comes back up, check if the AOK light turns green. If NOM stays red, the meter probably needs a hands-on look at the office."

**Spanish — First contact:**
"Reiniciando la tableta para restablecer la conexión del medidor (taxi {vehicle_number}). Dame 3 minutos y avísame."

## Common Misspellings
- "miter" / "muter" / "mutter" / "mitir" — meter
- "milage" / "miliage" — mileage

## Disambiguation: NOP vs NOM
- **NOP** (No PIM) = back-seat payment tablet issue → reboot PIM
- **NOM** (No Meter) = fare meter Bluetooth issue → reboot driver tablet
- Drivers sometimes confuse these. If they say "NOP" but describe a meter problem ("can't start trips"), treat it as a meter issue.
