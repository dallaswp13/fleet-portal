/**
 * SMS Rule Actions
 * runRuleOnMessage: test a rule against a message - parses intent and identifies vehicle
 * but does NOT execute MaaS360 actions (MaaS360 API integration pending)
 */

const ASC_FLEET_IDS = ['E', 'L', 'S', 'Y', 'U']

function extractVehicleNumber(text: string): string {
  const patterns = [
    /\bcab\s*#?\s*(\d{1,4})\b/i,
    /\bvehicle\s*#?\s*(\d{1,4})\b/i,
    /\bunit\s*#?\s*(\d{1,4})\b/i,
    /\bcar\s*#?\s*(\d{1,4})\b/i,
    /\b#(\d{1,4})\b/,
  ]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) return m[1]
  }
  const m = text.match(/(?<!\d)(\d{1,4})(?!\d)/)
  return m ? m[1] : ''
}

function extractLeaseNumber(text: string): string {
  const m = text.match(/\blease\s*(?:no:?|#|number:?)\s*(\d{4,6})\b/i)
  return m ? m[1] : ''
}

// Detect intent from message text without calling MaaS360
function detectIntent(smsText: string, ruleAction: string): {
  action: string; vehicle_number: string; lease_number: string; confidence: string; notes: string
} {
  const vehicle_number = extractVehicleNumber(smsText)
  const lease_number   = extractLeaseNumber(smsText)
  const lower = smsText.toLowerCase()

  // Map rule action to human-readable description
  const actionDesc: Record<string, string> = {
    reboot_driver:  'Reboot Driver Tablet',
    reboot_pim:     'Reboot PIM Tablet',
    kiosk_enter:    'Enable Kiosk Mode',
    kiosk_exit:     'Exit Kiosk Mode',
    clear_dispatch: 'Clear Dispatch App',
    clear_pim_bt:   'Clear PIM Bluetooth',
    clear_app_data: 'Clear App Data',
    support_driver: 'Initiate Driver Support',
    support_pim:    'Initiate PIM Support',
    auto_reply:     'Auto Reply',
  }

  // Determine confidence based on vehicle number extraction
  const confidence = vehicle_number ? 'high' : (lease_number ? 'medium' : 'low')

  const notes = [
    vehicle_number ? `Vehicle: #${vehicle_number}` : 'No vehicle number found',
    lease_number   ? `Lease: ${lease_number}`       : '',
    `Action: ${actionDesc[ruleAction] ?? ruleAction}`,
    lower.includes('nop') || lower.includes('no payment') ? 'Keyword: NoP/payment issue detected' : '',
    lower.includes('frozen') || lower.includes('freeze')  ? 'Keyword: frozen device detected' : '',
    lower.includes('bluetooth') || lower.includes(' bt ') ? 'Keyword: bluetooth issue detected' : '',
  ].filter(Boolean).join(' · ')

  return { action: ruleAction, vehicle_number, lease_number, confidence, notes }
}

export async function runRuleOnMessage(
  ruleAction: string,
  smsMessageId: string,
  service: Awaited<ReturnType<typeof import('@/lib/supabase/server')['createServiceClient']>>
): Promise<{ success: boolean; result: string; detail: string }> {
  const { data: msg } = await service.from('sms_messages').select('*').eq('id', smsMessageId).single()
  if (!msg) return { success: false, result: 'Message not found', detail: 'Message ID not in database' }

  const smsText = String(msg.sms_text ?? '')

  // Check if message actually matches the rule's keywords
  // Look up the rule to get its keywords
  const { data: rule } = await service.from('sms_rules')
    .select('keywords, name').eq('action', ruleAction).eq('enabled', true)
    .order('priority', { ascending: false }).limit(1).single()

  if (rule?.keywords?.length > 0) {
    const lower = smsText.toLowerCase()
    const matches = (rule.keywords as string[]).some(k => lower.includes(k.toLowerCase()))
    if (!matches) {
      return {
        success: false,
        result: `No keyword match`,
        detail: `Message does not contain any of: ${(rule.keywords as string[]).join(', ')}`,
      }
    }
  }

  // Parse intent from message text
  const intent = detectIntent(smsText, ruleAction)

  // Look up vehicle in ASC fleets if vehicle number found
  let vehicleNum  = intent.vehicle_number || (String(msg.vehicle_number ?? ''))
  let vehicleId   = msg.vehicle_id as string | null
  let vehicleInfo = ''

  if (vehicleNum && !vehicleId) {
    const { data: vehicle } = await service.from('vehicles')
      .select('id,vehicle_number,fleet_id,vehicle_name_key,office')
      .eq('vehicle_number', parseInt(vehicleNum))
      .in('fleet_id', ASC_FLEET_IDS)
      .single()

    if (vehicle) {
      vehicleId   = vehicle.id
      vehicleInfo = `Vehicle ${vehicle.vehicle_number} ${vehicle.fleet_id?.toUpperCase()} (${vehicle.office ?? 'ASC'}) matched`
    } else {
      vehicleInfo = `Vehicle ${vehicleNum} not found in ASC fleets`
    }
  } else if (vehicleId) {
    vehicleInfo = `Vehicle #${vehicleNum} already linked`
  }

  // Build result string
  const resultParts = [intent.notes, vehicleInfo].filter(Boolean)
  const result = resultParts.join(' · ')

  // Update message record with parsed intent (no M360 execution)
  await service.from('sms_messages').update({
    action:         ruleAction,
    vehicle_number: vehicleNum || msg.vehicle_number,
    vehicle_id:     vehicleId ?? msg.vehicle_id,
    confidence:     intent.confidence,
    reason:         `Rule test (no M360): ${intent.notes}`,
    result,
    success:        null,  // null = intent parsed, action not executed
    processed:      true,
  }).eq('id', smsMessageId)

  return {
    success: true,  // parsing succeeded even though M360 not called
    result,
    detail: vehicleInfo || (vehicleNum ? `Vehicle #${vehicleNum} identified` : 'No vehicle number in message'),
  }
}
