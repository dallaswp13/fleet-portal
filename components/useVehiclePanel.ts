'use client'
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { FleetOverview } from '@/types'

/**
 * Hook: given a vehicle_id, fetches the full FleetOverview and opens VehiclePanel.
 * Used by Devices and Lines pages so clicking any row opens the unified vehicle panel.
 */
export function useVehiclePanel() {
  const [vehicle,  setVehicle]  = useState<FleetOverview | null>(null)
  const [loading,  setLoading]  = useState<string | null>(null) // stores the id being fetched
  const [error,    setError]    = useState<string | null>(null)

  const open = useCallback(async (vehicleId: string) => {
    setLoading(vehicleId); setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('fleet_overview')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .single()
    setLoading(null)
    if (err || !data) setError('Could not load vehicle')
    else setVehicle(data as unknown as FleetOverview)
  }, [])

  /** Look up by vehicle_number + optional fleet_id */
  const openByNumber = useCallback(async (vehicleNumber: number, fleetId?: string | null) => {
    setLoading(String(vehicleNumber)); setError(null)
    const supabase = createClient()
    let q = supabase.from('fleet_overview').select('*').eq('vehicle_number', vehicleNumber)
    if (fleetId) q = q.ilike('fleet_id', fleetId)
    const { data, error: err } = await q.limit(1).single()
    setLoading(null)
    if (err || !data) setError('Could not load vehicle')
    else setVehicle(data as unknown as FleetOverview)
  }, [])

  const close = useCallback(() => setVehicle(null), [])

  return { vehicle, loading, error, open, openByNumber, close }
}
