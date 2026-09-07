-- ============================================================
-- Migration 27: Real-Time Guest & Staff Chat with Hybrid AI Assistant
-- Tables: guest_conversations, guest_chat_messages
-- ============================================================

-- 1. Create guest_conversations table
CREATE TABLE IF NOT EXISTS public.guest_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'BOT_ACTIVE' CHECK (status IN ('BOT_ACTIVE', 'STAFF_HANDOFF', 'RESOLVED')),
  assigned_staff_id UUID REFERENCES public.staff_users(id) ON DELETE SET NULL,
  guest_name TEXT,
  unread_guest_count INTEGER NOT NULL DEFAULT 0,
  unread_staff_count INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_sender TEXT CHECK (last_message_sender IS NULL OR last_message_sender IN ('GUEST', 'AI', 'STAFF', 'SYSTEM')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: 1 active conversation per room (can be resolved and re-opened or newly linked)
CREATE INDEX IF NOT EXISTS idx_guest_conversations_hotel_id ON public.guest_conversations(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_room_id ON public.guest_conversations(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_status ON public.guest_conversations(status);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_last_msg_at ON public.guest_conversations(last_message_at DESC);

-- 2. Create guest_chat_messages table
CREATE TABLE IF NOT EXISTS public.guest_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.guest_conversations(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('GUEST', 'AI', 'STAFF', 'SYSTEM')),
  sender_staff_id UUID REFERENCES public.staff_users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL DEFAULT 'Guest',
  message_text TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_conv_id ON public.guest_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_hotel_id ON public.guest_chat_messages(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_room_id ON public.guest_chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_created_at ON public.guest_chat_messages(created_at ASC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.guest_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_conversations' AND policyname = 'Allow read guest_conversations'
  ) THEN
    CREATE POLICY "Allow read guest_conversations" ON public.guest_conversations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_conversations' AND policyname = 'Allow write guest_conversations'
  ) THEN
    CREATE POLICY "Allow write guest_conversations" ON public.guest_conversations FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_chat_messages' AND policyname = 'Allow read guest_chat_messages'
  ) THEN
    CREATE POLICY "Allow read guest_chat_messages" ON public.guest_chat_messages FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_chat_messages' AND policyname = 'Allow write guest_chat_messages'
  ) THEN
    CREATE POLICY "Allow write guest_chat_messages" ON public.guest_chat_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. Enable Supabase Realtime for both tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_chat_messages;
  END IF;
END $$;
