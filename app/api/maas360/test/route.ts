import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testAuth } from '@/lib/maas360'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await testAuth()
  return NextResponse.json(result)
}
