import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://bsjnlawhdgfilcfejbji.supabase.co'
const DEFAULT_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzam5sYXdoZGdmaWxjZmVqYmppIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjI2OTEzOSwiZXhwIjoyMTAxODQ1MTM5fQ.JDtcNvuonuK_6sSL4evhWjoXdqUatQy4Oii4rBTMZF8'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_KEY

/**
 * POST /api/chat/resolve
 * Marks a conversation as RESOLVED and resets unread counts.
 * Body: { conversation_id, hotel_id, staff_user_id?, staff_name? }
 */
export async function POST(req: NextRequest) {
  try {
    const { conversation_id, hotel_id, staff_user_id, staff_name } = await req.json()

    if (!conversation_id || !hotel_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch conversation for room_id
    const { data: conv } = await supabase
      .from('guest_conversations')
      .select('id, room_id, status')
      .eq('id', conversation_id)
      .eq('hotel_id', hotel_id)
      .single()

    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Mark resolved
    const { error: updateErr } = await supabase
      .from('guest_conversations')
      .update({
        status: 'RESOLVED',
        unread_staff_count: 0,
        unread_guest_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Insert SYSTEM closure message
    const resolvedBy = staff_name ? `by ${staff_name}` : 'by staff'
    const systemMsgText = `✅ This conversation has been resolved ${resolvedBy}. If you need further assistance, please start a new chat.`

    await supabase.from('guest_chat_messages').insert({
      conversation_id,
      hotel_id,
      room_id: conv.room_id,
      sender_type: 'SYSTEM',
      sender_name: 'System',
      message_text: systemMsgText,
      is_read: false,
      ...(staff_user_id ? { sender_staff_id: staff_user_id } : {}),
    })

    await supabase.from('guest_conversations').update({
      last_message_text: systemMsgText,
      last_message_sender: 'SYSTEM',
      last_message_at: new Date().toISOString(),
    }).eq('id', conversation_id)

    return NextResponse.json({ success: true, status: 'RESOLVED' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
