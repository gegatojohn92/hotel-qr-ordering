-- ============================================================
-- Migration 28: Guest Chat Session Isolation & Phone Number
-- Adds session_id and guest_phone to guest_conversations
-- ============================================================

-- 1. Add session_id referencing guest_sessions table
ALTER TABLE public.guest_conversations 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL;

-- 2. Add guest_phone for callback reachability
ALTER TABLE public.guest_conversations 
ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- 3. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id ON public.guest_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone ON public.guest_conversations(guest_phone);

-- 4. Comments for schema documentation
COMMENT ON COLUMN public.guest_conversations.session_id IS 'Unique guest session ID to isolate chat history per guest check-in / scan';
COMMENT ON COLUMN public.guest_conversations.guest_phone IS 'Guest contact phone number for callbacks if chat is disconnected or escalated';
