import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWebPushToHotelStaff } from '@/lib/webPush'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * POST /api/chat/handoff
 * Escalates a BOT_ACTIVE conversation to STAFF_HANDOFF status.
 * Body: { conversation_id, hotel_id, room_id, guest_message? }
 */
export async function POST(req: NextRequest) {
  try {
    const { conversation_id, hotel_id, room_id, guest_message } = await req.json()

    if (!conversation_id || !hotel_id || !room_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Update conversation status to STAFF_HANDOFF
    const { error: updateErr } = await supabase
      .from('guest_conversations')
      .update({
        status: 'STAFF_HANDOFF',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)
      .eq('hotel_id', hotel_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Insert SYSTEM message to log the handoff
    const systemMsgText = '📋 Guest has requested to speak with a staff member. Conversation transferred to Front Desk.'
    await supabase.from('guest_chat_messages').insert({
      conversation_id,
      hotel_id,
      room_id,
      sender_type: 'SYSTEM',
      sender_name: 'System',
      message_text: systemMsgText,
      is_read: false,
    })

    // Update last message
    await supabase.from('guest_conversations').update({
      last_message_text: systemMsgText,
      last_message_sender: 'SYSTEM',
      last_message_at: new Date().toISOString(),
    }).eq('id', conversation_id)

    // Dispatch push to Front Desk & Admin staff
    const { data: roomData } = await supabase
      .from('rooms')
      .select('room_number')
      .eq('id', room_id)
      .maybeSingle()

    const pushBody = guest_message
      ? `"${String(guest_message).slice(0, 80)}"`
      : `A guest in Room ${roomData?.room_number || '?'} needs your assistance.`

    await sendWebPushToHotelStaff(hotel_id, {
      title: `🙋 Guest Handoff – Room ${roomData?.room_number || '?'}`,
      body: pushBody,
      requestType: 'CHAT_HANDOFF',
      roomNumber: roomData?.room_number,
      url: '/staff/chat',
      tag: `chat-handoff-${conversation_id}`,
    })

    return NextResponse.json({ success: true, status: 'STAFF_HANDOFF' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
