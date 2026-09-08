-- ============================================================
-- Migration 28: Add guest_phone and session_id to guest_conversations
-- Required for: guest session isolation + staff direct call feature
-- Run this in Supabase SQL Editor if not already applied.
-- ============================================================

-- Add session_id column (unique per guest QR scan session)
ALTER TABLE public.guest_conversations
  ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add guest_phone column (captured from phone prompt in guest web)
ALTER TABLE public.guest_conversations
  ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- Index for fast session lookups
CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id
  ON public.guest_conversations(session_id);

-- Index for phone lookups (optional but useful)
CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone
  ON public.guest_conversations(guest_phone);
