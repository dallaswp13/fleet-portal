-- Migration 040: SMS Pipeline Enhancements
--
-- Supports four feature changes:
--   1. Structured playbook loading (no schema changes needed)
--   2. Vehicle resolution — unknown number prompting (awaiting_vehicle status)
--   3. SMS rules as override layer (claude_classification, rule_override)
--   4. Feedback loop — category tagging (feedback_category)

-- Feature 3: Always-on Claude classification + rule override tracking
alter table public.sms_messages
  add column if not exists claude_classification text,  -- Claude's classification (always populated)
  add column if not exists rule_override         text;  -- populated only when a rule overrode Claude's decision

-- Feature 4: Category tagging on feedback
alter table public.sms_messages
  add column if not exists feedback_category text;  -- issue category at time of downvote (pim-payment, tablet-app, meter, etc.)

-- Index for category-aware feedback queries (loading lessons by category)
create index if not exists idx_sms_feedback_category
  on public.sms_messages(feedback_category, claude_feedback_at desc)
  where feedback_category is not null and claude_feedback is not null;

-- Index for awaiting_vehicle lookups (feature 2)
create index if not exists idx_sms_awaiting_vehicle
  on public.sms_messages(sender_phone, claude_status, received_at desc)
  where claude_status = 'awaiting_vehicle';
