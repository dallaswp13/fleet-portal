import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify caller is admin
  const service = await createServiceClient()
  const { data: profile } = await service.from('user_profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { email, is_admin = false, offices = null } = await req.json()
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

  // Send Supabase invite email
  const { data: invited, error } = await service.auth.admin.inviteUserByEmail(email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create user_profile with permissions
  if (invited?.user?.id) {
    await service.from('user_profiles').upsert({
      id:           invited.user.id,
      email,
      is_admin:     is_admin ?? false,
      offices:      offices ?? null,
      display_name: null,
    }, { onConflict: 'id' })
  }

  return NextResponse.json({ success: true, userId: invited?.user?.id })
}
