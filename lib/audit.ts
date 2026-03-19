import { createServiceClient } from '@/lib/supabase/server'

export async function writeAuditLog(params: {
  userEmail: string
  action: string
  targetType: 'device' | 'sim'
  targetId: string
  vehicleNumber?: number | null
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  success: boolean
}) {
  try {
    const supabase = await createServiceClient()
    await supabase.from('audit_log').insert({
      user_email: params.userEmail,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      vehicle_number: params.vehicleNumber ?? null,
      payload: params.payload ?? null,
      result: params.result ?? null,
      success: params.success
    })
  } catch (err) {
    // Never let audit logging crash the main request
    console.error('Audit log write failed:', err)
  }
}
