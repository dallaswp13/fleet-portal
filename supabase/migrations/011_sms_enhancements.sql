-- Migration 011: SMS enhancements - vehicle linking, rule reply_text, new columns

-- Add reply_text to sms_rules for auto-reply action
alter table public.sms_rules
  add column if not exists reply_text text;   -- Used when action = 'auto_reply'

-- Add vehicle linking and sender tracking to sms_messages
alter table public.sms_messages
  add column if not exists vehicle_id     uuid references public.vehicles(id) on delete set null,
  add column if not exists sender_phone   text,    -- digits-only sender phone for vehicle matching
  add column if not exists target         text,    -- 'driver' | 'pim' | null
  add column if not exists rule_name      text;    -- which rule matched, if any

create index if not exists idx_sms_messages_vehicle_id   on public.sms_messages(vehicle_id);
create index if not exists idx_sms_messages_sender_phone on public.sms_messages(sender_phone);

-- Update sms_rules default rules with new action types
delete from public.sms_rules where created_by = 'system';

insert into public.sms_rules (name, keywords, action, priority, created_by) values
  ('Reboot Driver Tablet',  array['reboot','restart','frozen','freeze','rebooted','boot','tablet down','screen stuck'], 'reboot_driver',  10, 'system'),
  ('Reboot PIM',            array['pim frozen','pim restart','pim reboot','payment frozen','cc machine'],              'reboot_pim',      9, 'system'),
  ('Kiosk Lock',            array['kiosk on','lock tablet','lockdown','restrict'],                                      'kiosk_enter',     5, 'system'),
  ('Kiosk Unlock',          array['kiosk off','unlock tablet','exit kiosk','free tablet'],                             'kiosk_exit',      5, 'system'),
  ('Clear Dispatch App',    array['dispatch frozen','dispatch crash','app crash','dispatch not working'],               'clear_dispatch',  7, 'system'),
  ('Clear PIM Bluetooth',   array['bluetooth','bt not working','pim not pairing','meter not connecting'],              'clear_pim_bt',    6, 'system'),
  ('Driver Support',        array['help','support','not working','issue','problem','broken'],                           'support_driver',  3, 'system'),
  ('PIM Support',           array['pim help','pim issue','payment issue','pim broken','cc problem'],                   'support_pim',     4, 'system');
