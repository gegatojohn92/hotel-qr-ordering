import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateSmartReplies, type AiChatMessage } from '@/lib/ai-assistant'

const DEFAULT_SUPABASE_URL = 'https://bsjnlawhdgfilcfejbji.supabase.co'
const DEFAULT_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzam5sYXdoZGdmaWxjZmVqYmppIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjI2OTEzOSwiZXhwIjoyMTAxODQ1MTM5fQ.JDtcNvuonuK_6sSL4evhWjoXdqUatQy4Oii4rBTMZF8'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_KEY

export async function POST(req: NextRequest) {
  try {
    const { conversation_id } = await req.json()

    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch last 6 messages for context
    const { data: messages, error } = await supabase
      .from('guest_chat_messages')
      .select('sender_type, message_text')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(6)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const history: AiChatMessage[] = (messages || [])
      .reverse()
      .map((m) => ({
        role: m.sender_type === 'GUEST' ? ('user' as const) : ('model' as const),
        text: m.message_text,
      }))

    const suggestions = await generateSmartReplies(history)

    return NextResponse.json({ suggestions })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
