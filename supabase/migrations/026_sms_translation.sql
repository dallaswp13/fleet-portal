-- Add translation columns to sms_messages
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS translated_text text;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS source_language text;
