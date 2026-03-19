export interface Vehicle {
  id: string
  vehicle_number: number
  fleet_id: string | null
  office: string | null
  sheet_tab: 'Active Vehicles' | 'Test Vehicles' | 'Surrenders'
  driver_app_version: string | null
  pim_app_version: string | null
  online_status: string | null
  driver_tablet_bluetooth_addr: string | null
  meter_status: string | null
  driver_tablet_phone_number: string | null
  pim_phone_number: string | null
  rfid: string | null
  meter_bluetooth_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Device {
  id: string
  vehicle_id: string | null
  device_name: string | null
  m360_user: string | null
  tablet_model: string | null
  android_os: string | null
  imei: string | null
  m360_policy: string | null
  m360_device_id: string | null
  compliance_status: string | null
  last_reported: string | null
  is_pim: boolean
  vehicle_number: number | null
  fleet_id: string | null
  created_at: string
  updated_at: string
}

export interface VerizonLine {
  id: string
  vehicle_id: string | null
  sub_account: string | null
  sub_account_name: string | null
  phone_number: string | null
  phone_status: string | null
  verizon_user: string | null
  mobile_plan: string | null
  monthly_usage_gb: number | null
  account_number: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_email: string
  action: string
  target_type: string
  target_id: string
  vehicle_number: number | null
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  success: boolean | null
  created_at: string
}

export interface FleetOverview {
  vehicle_id: string
  vehicle_number: number
  fleet_id: string | null
  office: string | null
  sheet_tab: string
  driver_app_version: string | null
  pim_app_version: string | null
  online_status: string | null
  driver_tablet_bluetooth_addr: string | null
  meter_status: string | null
  driver_tablet_phone_number: string | null
  pim_phone_number: string | null
  rfid: string | null
  meter_bluetooth_name: string | null
  notes: string | null
  vehicle_updated_at: string
  // Driver device
  device_id: string | null
  device_name: string | null
  m360_user: string | null
  tablet_model: string | null
  android_os: string | null
  imei: string | null
  m360_policy: string | null
  m360_device_id: string | null
  compliance_status: string | null
  last_reported: string | null
  // PIM device
  pim_device_id: string | null
  pim_device_name: string | null
  pim_m360_device_id: string | null
  pim_tablet_model: string | null
  pim_android_os: string | null
  pim_imei: string | null
  pim_m360_policy: string | null
  pim_compliance_status: string | null
  pim_last_reported: string | null
  // Driver Verizon line
  line_id: string | null
  sub_account: string | null
  sub_account_name: string | null
  phone_number: string | null
  phone_status: string | null
  verizon_user: string | null
  mobile_plan: string | null
  monthly_usage_gb: number | null
  account_number: string | null
  // PIM Verizon line
  pim_line_id: string | null
  pim_phone_number_verizon: string | null
  pim_phone_status: string | null
  pim_monthly_usage_gb: number | null
}

export type MaaS360Action =
  | 'reboot'           // Reboot device
  | 'wipe'             // Factory wipe (driver only)
  | 'kiosk_enter'      // Enable kiosk mode
  | 'kiosk_exit'       // Exit kiosk mode
  | 'clear_app_data'   // Clear all app data
  | 'clear_dispatch'   // Clear dispatch app data specifically
  | 'clear_pim_bt'     // Clear Bluetooth manager data (PIM pairing)
  | 'support_driver'   // Reboot + log support ticket (driver tablet)
  | 'support_pim'      // Reboot + log support ticket (PIM tablet)

// SMS rule action types (superset of MaaS360Action)
export type SmsRuleAction =
  | MaaS360Action
  | 'reboot_driver'    // Reboot driver tablet specifically
  | 'reboot_pim'       // Reboot PIM tablet specifically
  | 'auto_reply'       // Send automatic reply (no device action)

export interface ActionResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}
