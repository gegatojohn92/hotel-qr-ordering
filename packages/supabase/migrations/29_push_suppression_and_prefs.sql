-- ============================================================
-- Migration 29: Smart Push Suppression & Notification Settings
-- ============================================================
-- Creates:
--   1. staff_presence table           (presence-based push suppression)
--   2. notification_settings columns  (hotel-level push behaviour)
--   3. staff_users columns            (per-staff notification preferences)
--   4. guest_conversations column     (push cooldown tracking)
-- ============================================================

-- ── 1. staff_presence table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_presence (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id             UUID NOT NULL UNIQUE REFERENCES public.staff_users(id) ON DELETE CASCADE,
  hotel_id                  UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  -- Whether this staff member is currently focused in a chat conversation
  is_active_in_conversation BOOLEAN NOT NULL DEFAULT false,

  -- Which conversation they are viewing (null when not active)
  active_conversation_id    UUID REFERENCES public.guest_conversations(id) ON DELETE SET NULL,

  -- Timestamps: last_seen_at drives the 90-second staleness guard
  last_seen_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.staff_presence IS
  'Tracks which staff member is currently viewing a guest conversation. Used to suppress redundant FCM push notifications when staff are already actively engaged.';

-- Index: fast lookup by conversation_id filtered to active-only rows
CREATE INDEX IF NOT EXISTS idx_staff_presence_conversation
  ON public.staff_presence (active_conversation_id)
  WHERE is_active_in_conversation = true;

-- ── RLS for staff_presence ───────────────────────────────────
ALTER TABLE public.staff_presence ENABLE ROW LEVEL SECURITY;

-- Allow full access for service role (used by webPush.ts server-side queries)
CREATE POLICY "Service role full access to staff_presence"
  ON public.staff_presence
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 2. notification_settings — hotel-level push behaviour ────
ALTER TABLE public.notification_settings
  -- Suppress FCM for a staff member who is actively viewing that conversation
  ADD COLUMN IF NOT EXISTS suppress_if_active       BOOLEAN NOT NULL DEFAULT true,

  -- Minimum gap (in seconds) between FCM dispatches for the same conversation.
  -- CHAT_HANDOFF (escalation) always bypasses this.
  ADD COLUMN IF NOT EXISTS push_cooldown_seconds    INT     NOT NULL DEFAULT 30,

  -- Optional hotel-wide quiet hours window (Manila time, 0-23 hour)
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_from         INT     NOT NULL DEFAULT 22,  -- 10 PM
  ADD COLUMN IF NOT EXISTS quiet_hours_to           INT     NOT NULL DEFAULT 7;   -- 7 AM

COMMENT ON COLUMN public.notification_settings.suppress_if_active     IS 'When true, FCM is suppressed for a staff member who is already viewing the conversation';
COMMENT ON COLUMN public.notification_settings.push_cooldown_seconds   IS 'Minimum seconds between GUEST_CHAT pushes per conversation (0 = no cooldown). CHAT_HANDOFF bypasses this.';
COMMENT ON COLUMN public.notification_settings.quiet_hours_enabled     IS 'Enable hotel-wide quiet hours — no FCM dispatched during the quiet window';
COMMENT ON COLUMN public.notification_settings.quiet_hours_from        IS 'Start of quiet window (hour, 0-23, Manila/Asia timezone)';
COMMENT ON COLUMN public.notification_settings.quiet_hours_to          IS 'End of quiet window (hour, 0-23, Manila/Asia timezone). Window wraps midnight if from > to.';

-- Seed defaults for the default hotel
UPDATE public.notification_settings
SET
  suppress_if_active    = true,
  push_cooldown_seconds = 30,
  quiet_hours_enabled   = false,
  quiet_hours_from      = 22,
  quiet_hours_to        = 7
WHERE hotel_id = '00000000-0000-0000-0000-000000000001';

-- ── 3. staff_users — per-staff notification preferences ──────
ALTER TABLE public.staff_users
  -- Completely mute all guest chat FCM pushes for this staff account
  ADD COLUMN IF NOT EXISTS mute_guest_chat_push       BOOLEAN NOT NULL DEFAULT false,

  -- Suppress push only when this staff member is actively viewing that conversation
  ADD COLUMN IF NOT EXISTS suppress_push_when_active  BOOLEAN NOT NULL DEFAULT true,

  -- Optional personal quiet hours override (null = inherit hotel setting)
  ADD COLUMN IF NOT EXISTS quiet_hours_from_override  INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_to_override    INT DEFAULT NULL;

COMMENT ON COLUMN public.staff_users.mute_guest_chat_push       IS 'When true, this staff member receives no FCM pushes for guest chat events (both GUEST_CHAT and CHAT_HANDOFF)';
COMMENT ON COLUMN public.staff_users.suppress_push_when_active  IS 'When true, FCM is held for this staff member while they are actively viewing the affected conversation';
COMMENT ON COLUMN public.staff_users.quiet_hours_from_override  IS 'Personal quiet hours start (0-23). Overrides hotel setting when not null.';
COMMENT ON COLUMN public.staff_users.quiet_hours_to_override    IS 'Personal quiet hours end (0-23). Overrides hotel setting when not null.';

-- ── 4. guest_conversations — push cooldown tracking ──────────
ALTER TABLE public.guest_conversations
  -- Timestamp of the last FCM push dispatched for this conversation (for cooldown enforcement)
  ADD COLUMN IF NOT EXISTS last_push_sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.guest_conversations.last_push_sent_at IS
  'Timestamp of the last successfully dispatched FCM push for this conversation. Used to enforce push_cooldown_seconds between routine GUEST_CHAT notifications.';

CREATE INDEX IF NOT EXISTS idx_guest_conversations_last_push
  ON public.guest_conversations (id, last_push_sent_at)
  WHERE last_push_sent_at IS NOT NULL;
