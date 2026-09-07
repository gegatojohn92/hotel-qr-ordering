import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateAiResponse, type AiChatMessage } from '@/lib/ai-assistant'
import { sendWebPushToHotelStaff } from '@/lib/webPush'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(req: NextRequest) {
  try {
    const { conversation_id, hotel_id, room_id, message_text, sender_name, guest_name } =
      await req.json()

    if (!hotel_id || !room_id || !message_text?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // ── 1. Upsert conversation ──────────────────────────────────────────────
    let convId = conversation_id as string | null

    if (!convId) {
      // Try to find an existing non-resolved conversation for this room
      const { data: existing } = await supabase
        .from('guest_conversations')
        .select('id, status')
        .eq('hotel_id', hotel_id)
        .eq('room_id', room_id)
        .neq('status', 'RESOLVED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        convId = existing.id
      } else {
        // Create new conversation
        const { data: newConv, error: convErr } = await supabase
          .from('guest_conversations')
          .insert({
            hotel_id,
            room_id,
            status: 'BOT_ACTIVE',
            guest_name: guest_name || sender_name || 'Guest',
            last_message_text: message_text,
            last_message_sender: 'GUEST',
            last_message_at: new Date().toISOString(),
          })
          .select('id, status')
          .single()

        if (convErr || !newConv) {
          return NextResponse.json({ error: convErr?.message || 'Failed to create conversation' }, { status: 500 })
        }
        convId = newConv.id
      }
    }

    // ── 2. Fetch current conversation state ────────────────────────────────
    const { data: conv } = await supabase
      .from('guest_conversations')
      .select('id, status, unread_staff_count')
      .eq('id', convId)
      .single()

    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // ── 3. Insert guest message ─────────────────────────────────────────────
    const { data: guestMsg, error: msgErr } = await supabase
      .from('guest_chat_messages')
      .insert({
        conversation_id: convId,
        hotel_id,
        room_id,
        sender_type: 'GUEST',
        sender_name: sender_name || guest_name || 'Guest',
        message_text: message_text.trim(),
        is_read: false,
      })
      .select('id, created_at')
      .single()

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 })
    }

    // ── 4. Update conversation last message ────────────────────────────────
    const newUnreadStaff = (conv.unread_staff_count || 0) + 1
    await supabase
      .from('guest_conversations')
      .update({
        last_message_text: message_text.trim(),
        last_message_sender: 'GUEST',
        last_message_at: new Date().toISOString(),
        unread_staff_count: newUnreadStaff,
        updated_at: new Date().toISOString(),
      })
      .eq('id', convId)

    // ── 5. AI Auto-Reply (if BOT_ACTIVE) ───────────────────────────────────
    let aiMessage: { id: string; message_text: string; created_at: string } | null = null

    if (conv.status === 'BOT_ACTIVE') {
      // Fetch recent history for context
      const { data: recentMsgs } = await supabase
        .from('guest_chat_messages')
        .select('sender_type, message_text')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(10)

      const history: AiChatMessage[] = (recentMsgs || [])
        .reverse()
        .map((m) => ({
          role: m.sender_type === 'GUEST' ? ('user' as const) : ('model' as const),
          text: m.message_text,
        }))

      const aiResponse = await generateAiResponse(message_text.trim(), history)

      // Insert AI response
      const { data: aiMsg } = await supabase
        .from('guest_chat_messages')
        .insert({
          conversation_id: convId,
          hotel_id,
          room_id,
          sender_type: aiResponse.shouldEscalate ? 'SYSTEM' : 'AI',
          sender_name: 'Kekehyu AI',
          message_text: aiResponse.text,
          is_read: false,
        })
        .select('id, message_text, created_at')
        .single()

      if (aiMsg) aiMessage = aiMsg

      // Update conversation unread for guest
      const { data: convAfterAi } = await supabase
        .from('guest_conversations')
        .select('unread_guest_count')
        .eq('id', convId)
        .single()

      await supabase
        .from('guest_conversations')
        .update({
          last_message_text: aiResponse.text,
          last_message_sender: aiResponse.shouldEscalate ? 'SYSTEM' : 'AI',
          last_message_at: new Date().toISOString(),
          unread_guest_count: (convAfterAi?.unread_guest_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', convId)

      // Escalate if needed
      if (aiResponse.shouldEscalate) {
        await supabase
          .from('guest_conversations')
          .update({ status: 'STAFF_HANDOFF', updated_at: new Date().toISOString() })
          .eq('id', convId)

        // Dispatch push notification
        const { data: roomData } = await supabase
          .from('rooms')
          .select('room_number')
          .eq('id', room_id)
          .maybeSingle()

        await sendWebPushToHotelStaff(hotel_id, {
          title: `💬 Guest Chat – Room ${roomData?.room_number || '?'}`,
          body: `A guest needs staff assistance: "${message_text.slice(0, 80)}"`,
          requestType: 'CHAT_HANDOFF',
          roomNumber: roomData?.room_number,
          url: '/staff/chat',
          tag: `chat-handoff-${convId}`,
        })
      }
    } else if (conv.status === 'STAFF_HANDOFF') {
      // Notify staff of new guest message
      const { data: roomData } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', room_id)
        .maybeSingle()

      await sendWebPushToHotelStaff(hotel_id, {
        title: `💬 Guest Message – Room ${roomData?.room_number || '?'}`,
        body: message_text.slice(0, 100),
        requestType: 'GUEST_CHAT',
        roomNumber: roomData?.room_number,
        url: '/staff/chat',
        tag: `guest-chat-${convId}`,
      })
    }

    return NextResponse.json({
      success: true,
      conversation_id: convId,
      message_id: guestMsg?.id,
      ai_reply: aiMessage,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Chat Send] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
