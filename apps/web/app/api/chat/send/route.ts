import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateAiResponse, type AiChatMessage } from '@/lib/ai-assistant'
import { sendWebPushToHotelStaff } from '@/lib/webPush'

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
    const { conversation_id, hotel_id, room_id, session_id, guest_phone, message_text, sender_name, guest_name } =
      await req.json()

    if (!hotel_id || !room_id || !message_text?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // ── 1. Upsert conversation ──────────────────────────────────────────────
    let convId = conversation_id as string | null

    if (!convId) {
      // 1a. Try to find active conversation scoped to session_id if provided
      if (session_id) {
        try {
          const { data: scopedConv } = await supabase
            .from('guest_conversations')
            .select('id, status')
            .eq('hotel_id', hotel_id)
            .eq('room_id', room_id)
            .eq('session_id', session_id)
            .neq('status', 'RESOLVED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (scopedConv?.id) {
            convId = scopedConv.id
          }
        } catch {
          // session_id column might not exist or failed
        }
      }

      // 1b. No room-wide fallback: If no active conversation exists for this specific
      //     session or conversation ID, always create a brand-new conversation so
      //     new guests / QR scans never inherit a previous guest's chat history.

      // 1c. Create new conversation if none exists
      if (!convId) {
        let effectivePhone = guest_phone ? String(guest_phone).trim() : null
        if (!effectivePhone && session_id) {
          try {
            const { data: sessData } = await supabase
              .from('guest_sessions')
              .select('phone_number')
              .eq('id', session_id)
              .maybeSingle()

            if (sessData?.phone_number) {
              effectivePhone = sessData.phone_number
            }
          } catch {
            // ignore session phone query error
          }
        }

        let createdConv: { id: string; status: string } | null = null

        // Attempt rich insert with session_id and guest_phone
        if (session_id || effectivePhone) {
          const richPayload: Record<string, any> = {
            hotel_id,
            room_id,
            status: 'BOT_ACTIVE',
            guest_name: guest_name || sender_name || 'Guest',
            last_message_text: message_text,
            last_message_sender: 'GUEST',
            last_message_at: new Date().toISOString(),
          }
          if (session_id) richPayload.session_id = session_id
          if (effectivePhone) richPayload.guest_phone = effectivePhone

          const { data: richConv, error: richErr } = await supabase
            .from('guest_conversations')
            .insert(richPayload)
            .select('id, status')
            .single()

          if (!richErr && richConv) {
            createdConv = richConv
          } else {
            console.warn('[Chat Send] Rich insert notice:', richErr?.message)
          }
        }

        // Resilient fallback: baseline insert without session/phone columns
        if (!createdConv) {
          const { data: baseConv, error: baseErr } = await supabase
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

          if (baseErr || !baseConv) {
            return NextResponse.json(
              { error: baseErr?.message || 'Failed to create conversation' },
              { status: 500 }
            )
          }
          createdConv = baseConv
        }

        convId = createdConv.id
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

    // Safely check for phone on conversation
    let conversationPhone: string | null = guest_phone || null
    try {
      const { data: phoneRow } = await supabase
        .from('guest_conversations')
        .select('guest_phone')
        .eq('id', convId)
        .maybeSingle()
      if (phoneRow && 'guest_phone' in phoneRow && phoneRow.guest_phone) {
        conversationPhone = phoneRow.guest_phone
      }
    } catch {
      // Column may not exist yet
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
    const baselineUpdate: Record<string, any> = {
      last_message_text: message_text.trim(),
      last_message_sender: 'GUEST',
      last_message_at: new Date().toISOString(),
      unread_staff_count: newUnreadStaff,
      updated_at: new Date().toISOString(),
    }

    if (guest_phone?.trim() || session_id) {
      const richUpdate = { ...baselineUpdate }
      if (guest_phone?.trim()) richUpdate.guest_phone = guest_phone.trim()
      if (session_id) richUpdate.session_id = session_id

      const { error: richErr } = await supabase
        .from('guest_conversations')
        .update(richUpdate)
        .eq('id', convId)

      if (richErr) {
        // Fall back to baseline update if extra columns don't exist
        await supabase
          .from('guest_conversations')
          .update(baselineUpdate)
          .eq('id', convId)
      }
    } else {
      await supabase
        .from('guest_conversations')
        .update(baselineUpdate)
        .eq('id', convId)
    }

    const effectivePhoneForPush = conversationPhone || guest_phone || null

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

        const phoneInfo = effectivePhoneForPush ? ` · 📞 ${effectivePhoneForPush}` : ''
        await sendWebPushToHotelStaff(hotel_id, {
          title: `💬 Guest Chat – Room ${roomData?.room_number || '?'}${phoneInfo}`,
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

      const phoneInfo = effectivePhoneForPush ? ` · 📞 ${effectivePhoneForPush}` : ''
      await sendWebPushToHotelStaff(hotel_id, {
        title: `💬 Guest Message – Room ${roomData?.room_number || '?'}${phoneInfo}`,
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
