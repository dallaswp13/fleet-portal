# PIM / Payment Issues (includes NOP)

> ~60% of all incoming support requests. This is the dominant issue by far.

## What Is Happening

The PIM (Passenger Information Monitor) is the back-seat tablet that handles credit card payments. When it loses connection to the driver tablet or the dispatch system, the driver tablet shows a red **NOP** (No PIM) indicator. Drivers can't process card payments until it's resolved.

**NOP = No PIM.** These are the same issue. Don't treat them as separate categories.

## Sub-Types

### NOP Red Light
The PIM connection has dropped. The driver tablet shows red where it should be green.
- **Driver says:** "NOP is red," "NoP red lights," "I have NOP," "red NoP," "NOM red," "sistema en rojo"
- **Action:** `reboot_pim`
- **Expected fix time:** 2-3 minutes after reboot

### Credit Card Machine Not Working
The PIM is powered on but won't process card transactions.
- **Driver says:** "credit card machine not working," "can't charge with card," "the tap doesn't work," "card reader says connecting"
- **Action:** `reboot_pim` → if persists, `clear_pim_bt` (Bluetooth reset)
- **Expected fix time:** 2-5 minutes

### PIM Screen Frozen / Off / Dark
The back-seat tablet is unresponsive or showing the wrong screen.
- **Driver says:** "back tablet frozen," "screen is off," "back tablet not working," "back screen turns off"
- **Action:** `reboot_pim`
- **Escalation:** If reboot fails twice → suggest office visit for possible hardware swap

### Square Reader Issues
Some cabs use Square card readers instead of integrated PIM.
- **Driver says:** "fix my square," "square not working," "square reader issues"
- **Action:** `reboot_pim` (Square connects through the PIM system)
- **Note:** Square-specific issues may require app-level troubleshooting

### No Power to PIM
Battery dead or power supply disconnected. Common cause: plug under the steering wheel gets kicked loose.
- **Driver says:** "no power," "battery is down, no power supply," "machine turns off as soon as I turn it on"
- **Action:** Ask driver to check if the cable under the steering wheel is plugged in firmly. If yes, suggest office visit.
- **Note:** Remote reboot won't help if there's no power. Don't waste time sending one.

## Resolution Flow

```
1. Driver reports PIM/NOP issue
   ├─ Can you identify the cab number?
   │   ├─ YES → Send reboot_pim, reply: "Sending PIM reboot to cab [X] now. Give it 2-3 minutes and let me know."
   │   └─ NO → Reply: "What's your cab number?"
   │
2. Driver confirms still not working after reboot
   ├─ Try clear_pim_bt (Bluetooth reset)
   ├─ Reply: "Trying a Bluetooth reset now. Give it another few minutes."
   │
3. Still not working after BT reset
   ├─ Ask: "Can you check if the cable under the steering wheel is plugged in tight?"
   │
4. Still not working
   └─ Reply: "Looks like this needs a hands-on fix. Please bring the cab to the office [when office is open]."
```

## Response Templates

**English — First contact:**
"Sending a PIM reboot to cab {vehicle_number} now. Give it 2-3 minutes to come back online and let me know if it's working."

**English — After first reboot failed:**
"Let me try a Bluetooth reset on the PIM. Give it a few more minutes. If it still doesn't work, check the power cable under the steering wheel."

**English — Escalation:**
"This one probably needs a hands-on look. Can you bring the cab to the office? We'll get the PIM swapped out."

**Spanish — First contact:**
"Enviando reinicio del PIM al taxi {vehicle_number}. Dale 2-3 minutos y avísame si funciona."

**Spanish — After first reboot failed:**
"Voy a intentar un reinicio de Bluetooth en el PIM. Espera unos minutos más. Si sigue sin funcionar, revisa el cable de alimentación debajo del volante."

**Spanish — Escalation:**
"Parece que necesita revisión en persona. ¿Puedes traer el taxi a la oficina? Te lo arreglamos."

## Common Misspellings & Shorthand
- "nop" / "NoP" / "NOP" / "N O P" / "n.o.p"
- "nom" (sometimes used interchangeably with NOP, though technically NOM = No Meter)
- "pim" / "PIM" / "the pim"
- "mitter" / "muter" / "mutter" — these usually mean meter, NOT PIM, but check context
- "rojo" = red (Spanish)
- "congelada" = frozen (Spanish)

## Known Repeat Offenders
These cabs report PIM issues frequently and may have underlying hardware problems. Suggest office visit sooner:
- Cab 6472 (driver 818-476-2322) — chronic NOP, often multiple times per day
- Cab 6161 (driver 323-602-7642) — recurring NOP, especially on airport days
- Cab 6260/6664 (driver 442-202-7045) — plug wiring issue suspected
- Cab 6076 (driver 213-905-8434) — frequent resets, possible faulty PIM unit
