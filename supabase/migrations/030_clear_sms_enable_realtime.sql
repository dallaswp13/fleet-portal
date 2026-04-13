-- Migration 030: Clear the inbox and enable Supabase Realtime on sms_messages.
--
-- Rationale: Gmail polling has been removed in favor of the Twilio webhook.
-- The existing rows in sms_messages are a mix of demo data and poll-era
-- Gmail imports that no longer reflect the live conversation state. We start
-- fresh and rely on the webhook + processInboundSms pipeline from here on.
--
-- Enabling realtime lets the SMS page subscribe to INSERT/UPDATE events so
-- new inbound messages and outbound auto-replies render without a manual
-- refresh.

-- 1. Clear existing messages
TRUNCATE TABLE public.sms_messages RESTART IDENTITY;

-- 2. Enable realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sms_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
  END IF;
END $$;
