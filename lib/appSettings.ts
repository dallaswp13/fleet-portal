/**
 * App-level settings — server-side helpers.
 *
 * Reads from public.app_settings, which is seeded by migration 034. All keys
 * default to a safe value if the row is missing (e.g. the migration hasn't
 * run yet, or the key was deleted). Callers should NOT assume the setting
 * exists — they should fall back to the default.
 *
 * The two currently-used settings back the Claude button in the header:
 *   - claude_responding_enabled      → gates handleClaudeConversation()
 *   - claude_execute_actions_enabled → gates Claude-initiated M360 actions
 *
 * Results are intentionally NOT cached: the whole point of these toggles is
 * that they must take effect immediately across all serverless invocations.
 * A stale cache would defeat the purpose (e.g. Dallas flips "responding" off
 * and a Claude reply still fires 30 seconds later).
 */

import { createServiceClient } from '@/lib/supabase/server'

export type AppSettingKey =
  | 'claude_responding_enabled'
  | 'claude_execute_actions_enabled'

const DEFAULTS: Record<AppSettingKey, unknown> = {
  // Safe defaults mirror migration 034's seeded values.
  claude_responding_enabled: true,
  claude_execute_actions_enabled: true,
}

export async function getAppSetting<T = unknown>(key: AppSettingKey): Promise<T> {
  const svc = await createServiceClient()
  const { data, error } = await svc
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error || !data) return DEFAULTS[key] as T
  return data.value as T
}

export async function getAllAppSettings(): Promise<Record<AppSettingKey, unknown>> {
  const svc = await createServiceClient()
  const { data, error } = await svc.from('app_settings').select('key,value')

  const out = { ...DEFAULTS } as Record<AppSettingKey, unknown>
  if (error || !data) return out
  for (const row of data as { key: string; value: unknown }[]) {
    if (row.key in DEFAULTS) {
      out[row.key as AppSettingKey] = row.value
    }
  }
  return out
}

// Convenience wrappers for the two boolean toggles — these are the most
// common call sites and a typed boolean helper keeps caller code tidy.
export async function isClaudeRespondingEnabled(): Promise<boolean> {
  const v = await getAppSetting<unknown>('claude_responding_enabled')
  return v === true
}

export async function isClaudeExecuteActionsEnabled(): Promise<boolean> {
  const v = await getAppSetting<unknown>('claude_execute_actions_enabled')
  return v === true
}
