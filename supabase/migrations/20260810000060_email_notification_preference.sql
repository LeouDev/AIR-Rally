-- One on/off preference for whether a user receives the email copy of
-- their notifications, checked by the notification-created webhook
-- (src/app/api/webhooks/notification-created/route.ts) before it sends.
-- The in-app notification itself is unaffected either way — this only
-- gates the email.
--
-- A single boolean, deliberately, not a per-type preference matrix:
-- nothing has asked for "let me turn off booking emails but keep credit
-- emails," and a settings screen with twelve toggles nobody asked for is
-- worse than one that does the one thing that was actually requested.
--
-- No new trigger needed: profiles_prevent_role_change only guards the
-- `role` column (see prevent_role_self_escalation(), 20260809000001) —
-- this column is freely updatable by the owning user under the existing
-- "Users can update their own profile" RLS policy.
alter table public.profiles
  add column email_notifications_enabled boolean not null default true;

comment on column public.profiles.email_notifications_enabled is
  'Whether this user receives the email copy of their in-app notifications. Does not affect the in-app notification itself. Checked by /api/webhooks/notification-created before sending.';
