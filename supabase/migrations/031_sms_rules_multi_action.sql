-- Migration 031: Multi-action support for sms_rules.
--
-- Rationale: Rules were limited to a single action per match. A common
-- workflow (e.g. NoM arrives) needs both an auto-reply AND a follow-up M360
-- action (reboot_pim). Adding `actions text[]` lets one rule execute/tag
-- multiple actions. The legacy `action` column is kept in sync with
-- actions[0] for backward compatibility and to keep the "Execute" flow
-- (which takes a single action per message) unchanged.

-- 1. Add the new column
ALTER TABLE public.sms_rules
  ADD COLUMN IF NOT EXISTS actions text[];

-- 2. Backfill from existing action column
UPDATE public.sms_rules
SET actions = ARRAY[action]
WHERE actions IS NULL AND action IS NOT NULL;

-- 3. Keep action and actions[0] in sync via trigger so legacy readers
--    continue to work without code changes.
CREATE OR REPLACE FUNCTION public.sms_rules_sync_actions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If actions is set, ensure action mirrors the first element
  IF NEW.actions IS NOT NULL AND array_length(NEW.actions, 1) > 0 THEN
    NEW.action := NEW.actions[1];
  -- Else if only action was set (legacy insert), populate actions from it
  ELSIF NEW.action IS NOT NULL THEN
    NEW.actions := ARRAY[NEW.action];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_rules_sync_actions_trigger ON public.sms_rules;
CREATE TRIGGER sms_rules_sync_actions_trigger
  BEFORE INSERT OR UPDATE ON public.sms_rules
  FOR EACH ROW EXECUTE FUNCTION public.sms_rules_sync_actions();
