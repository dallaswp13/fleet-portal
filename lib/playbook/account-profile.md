# Account / Profile Issues

> ~2% of all incoming support requests.

## What Is Happening

Non-technical requests related to the driver's account, vehicle registration status, or app profile information. These typically can't be resolved via remote device actions — they require backend database changes.

## Sub-Types

### Registration Expired Message
Tablet blocks login because vehicle registration shows as expired, even though the driver has renewed.
- **Driver says:** "tab says car registration expired," "can't sign in, says registration expired," "I have new registration but tablet won't let me"
- **Action:** Do NOT reboot. This is a database issue. The vehicle's registration date needs to be updated in the fleet system.
- **Reply:** "That's a registration update issue, not a tablet problem. I'll flag it to get your records updated. In the meantime, if you have proof of your new registration, bring it to the office."

### License Plate Update
Old license plate number is showing on the Uber or Yellow Cab app.
- **Driver says:** "customers see my old license plate," "please update to current license plate," "plate number wrong on app"
- **Action:** Needs backend update. Note the new plate number and escalate.

### Driver Balance / Earnings Inquiry
Driver can't view their earnings or balance on the tablet.
- **Driver says:** "can't check driver balance," "balance not showing on tablet," "want to see my earnings"
- **Action:** `reboot_driver` may help if the balance screen is just frozen. Otherwise, direct to office.

### Access Paratransit Sign-In
Issues specifically with the Access (paratransit) dispatch integration.
- **Driver says:** "Access sign-in not working," "can't connect to Access dispatch," "Access has been two weeks issue"
- **Action:** Access issues often require coordination with Access dispatch. Escalate to Dallas.
- **Note:** Some drivers do both Yellow Cab and Access rides. Access integration problems are separate from regular dispatch.

### DriveMate Account Locked / Suspended
Driver's dispatch account is suspended or locked, preventing sign-in.
- **Driver says:** "when can I sign back on," "my account is locked," "can't log in to DriveMate"
- **Action:** This is an admin/HR issue, not technical. Escalate.

## Resolution Flow

```
1. Registration expired → Escalate (database update needed)
2. Plate update → Note new plate, escalate
3. Balance issue → Try reboot_driver, then office
4. Access issue → Escalate to Dallas
5. Account locked → Escalate (admin/HR decision)
```

## Response Templates

**English — Registration:**
"That's a registration update in our system, not a tablet issue. I'll flag it to get your records updated. If you have your new registration paperwork, bring it to the office to speed things up."

**English — General escalation:**
"That's something that needs to be handled by the office. I'll make a note of it — can you give me your cab number and lease number?"

**Spanish — Registration:**
"Es un problema de actualización de registro en nuestro sistema, no de la tableta. Lo voy a reportar. Si tienes tu registro nuevo, llévalo a la oficina para agilizar."
