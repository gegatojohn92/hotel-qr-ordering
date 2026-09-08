'use client'

/**
 * GuestChatWidget — Persistent Floating AI Chat for Hotel Guest Web
 * Features:
 * - Bottom-right FAB with unread badge counter
 * - Glassmorphic expandable chat drawer
 * - Dynamic header: 🤖 AI Concierge ↔ 🧑‍💼 Front Desk Staff
 * - Message bubbles: Gold (Guest), Dark (AI), Indigo (Staff), System (Grey)
 * - Realtime updates via Supabase WebSocket subscription
 * - Quick prompt chips for common queries
 * - "Connect to Human Staff" escalation button
 * - Typing indicator
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { GuestChatMessage, GuestConversation } from '@hotel-qr/supabase/types'
import PhoneCaptureModal, {
  getStoredGuestPhone,
  getStoredGuestSessionId,
  getOrCreateGuestSessionId,
  storeGuestSessionId,
  getStoredGuestConversationId,
  storeGuestConversationId,
} from './PhoneCaptureModal'

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  '🍽️ Restaurant hours?',
  '🕛 Check-out time?',
  '📶 WiFi password?',
  '💆 Spa booking?',
  '🏊 Pool hours?',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface OptimisticMessage extends Partial<GuestChatMessage> {
  id: string
  message_text: string
  sender_type: 'GUEST' | 'AI' | 'STAFF' | 'SYSTEM'
  sender_name: string
  created_at: string
  isOptimistic?: boolean
}

// ─── Bubble Style Helper ──────────────────────────────────────────────────────

function getBubbleStyle(senderType: string, isOptimistic = false): React.CSSProperties {
  switch (senderType) {
    case 'GUEST':
      return {
        alignSelf: 'flex-end',
        background: isOptimistic
          ? 'linear-gradient(135deg, #d97706, #f59e0b)'
          : 'linear-gradient(135deg, #f59e0b, #fbbf24)',
        color: '#1a1200',
        borderRadius: '18px 18px 4px 18px',
        boxShadow: '0 4px 15px rgba(251,191,36,0.35)',
        opacity: isOptimistic ? 0.75 : 1,
        maxWidth: '78%',
      }
    case 'AI':
      return {
        alignSelf: 'flex-start',
        background: 'linear-gradient(135deg, rgba(30,30,50,0.9), rgba(40,40,70,0.9))',
        color: '#e2e8f0',
        borderRadius: '18px 18px 18px 4px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        maxWidth: '82%',
        border: '1px solid rgba(139,92,246,0.25)',
      }
    case 'STAFF':
      return {
        alignSelf: 'flex-start',
        background: 'linear-gradient(135deg, rgba(79,70,229,0.85), rgba(99,102,241,0.85))',
        color: '#e0e7ff',
        borderRadius: '18px 18px 18px 4px',
        boxShadow: '0 4px 15px rgba(99,102,241,0.35)',
        maxWidth: '82%',
        border: '1px solid rgba(165,180,252,0.3)',
      }
    case 'SYSTEM':
      return {
        alignSelf: 'center',
        background: 'rgba(100,116,139,0.25)',
        color: '#94a3b8',
        borderRadius: '12px',
        fontSize: '12px',
        maxWidth: '90%',
        textAlign: 'center',
      }
    default:
      return { alignSelf: 'flex-start', maxWidth: '80%' }
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function renderFormattedMessage(text: string) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, lIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    return (
      <span key={lIdx} style={{ display: 'block', minHeight: line.trim() ? undefined : '0.5em' }}>
        {parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={pIdx} style={{ fontWeight: 700, color: 'inherit' }}>
                {part.slice(2, -2)}
              </strong>
            )
          }
          return part
        })}
      </span>
    )
  })
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GuestChatWidget() {
  const searchParams = useSearchParams()
  const roomId = searchParams.get('room')
  const hotelId = searchParams.get('hotel_id')

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<OptimisticMessage[]>([])
  const [conversation, setConversation] = useState<GuestConversation | null>(null)
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isTypingAi, setIsTypingAi] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null)
  const [hotelIdResolved, setHotelIdResolved] = useState<string>(
    hotelId || '00000000-0000-0000-0000-000000000001'
  )
  const [effectiveRoomId, setEffectiveRoomId] = useState<string | null>(roomId)
  const [isEscalating, setIsEscalating] = useState(false)
  const [showEscalateConfirm, setShowEscalateConfirm] = useState(false)
  const [showPhoneModal, setShowPhoneModal] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null)
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null)

  const supabase = createSupabaseBrowserClient()

  // ── Handle Chat Drawer Toggle with Phone Gate ────────────────────────────
  const handleToggleChat = () => {
    if (isOpen) {
      setIsOpen(false)
      return
    }
    const phone = getStoredGuestPhone()
    if (!phone) {
      setShowPhoneModal(true)
    } else {
      setIsOpen(true)
    }
  }

  const handlePhoneSuccess = (phone: string, newSessionId?: string) => {
    setShowPhoneModal(false)
    if (newSessionId && effectiveRoomId) {
      storeGuestSessionId(effectiveRoomId, newSessionId)
    }
    setIsOpen(true)
    loadConversation()
  }

  // ── Resolve room/hotel if missing ────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    setEffectiveRoomId(roomId)
    getOrCreateGuestSessionId(roomId)

    if (hotelId) {
      setHotelIdResolved(hotelId)
      return
    }

    // Fetch hotel_id from room record
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('rooms')
        .select('hotel_id')
        .eq('id', roomId)
        .maybeSingle()
      if (data?.hotel_id) setHotelIdResolved(data.hotel_id)
    })()
  }, [roomId, hotelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom on new message ─────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  // ── Focus input when opened ──────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 150)
  }, [isOpen])

  // ── Load existing conversation scoped strictly to active guest session ────
  const loadConversation = useCallback(async () => {
    if (!effectiveRoomId || !hotelIdResolved) return

    const storedConvId = getStoredGuestConversationId(effectiveRoomId)
    const activeSessionId = getStoredGuestSessionId(effectiveRoomId)
    let conv: any = null

    // 1. First, check by explicit stored conversation ID for this session/tab
    if (storedConvId) {
      try {
        const { data: convById, error: convErr } = await (supabase as any)
          .from('guest_conversations')
          .select('*')
          .eq('id', storedConvId)
          .neq('status', 'RESOLVED')
          .maybeSingle()

        if (!convErr && convById) {
          conv = convById
        }
      } catch {
        // ignore
      }
    }

    // 2. Second, if no conversation found by ID, try loading by active session_id
    if (!conv && activeSessionId) {
      try {
        const { data: scopedConv, error: scopedErr } = await (supabase as any)
          .from('guest_conversations')
          .select('*')
          .eq('room_id', effectiveRoomId)
          .eq('hotel_id', hotelIdResolved)
          .eq('session_id', activeSessionId)
          .neq('status', 'RESOLVED')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!scopedErr && scopedConv) {
          conv = scopedConv
          storeGuestConversationId(effectiveRoomId, scopedConv.id)
        }
      } catch {
        // session_id column might not exist or query failed
      }
    }

    // 3. IMPORTANT: NO room-level fallback!
    //    If no conversation is bound to this guest's active session, conv remains null.
    //    This guarantees a clean slate (0 messages) for new guests or fresh QR scans.
    if (conv) {
      setConversation(conv)
      setUnreadCount(conv.unread_guest_count || 0)

      // Load messages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: msgs } = await (supabase as any)
        .from('guest_chat_messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true })
        .limit(80)

      if (msgs) {
        setMessages(msgs as OptimisticMessage[])
      }
    } else {
      setConversation(null)
      setMessages([])
      setUnreadCount(0)
    }
  }, [effectiveRoomId, hotelIdResolved]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadConversation()
  }, [loadConversation])

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!conversation?.id) return

    const channelName = `guest-chat-${conversation.id}`

    const channel = supabase.channel(channelName)

    channel
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'guest_chat_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload: { new: GuestChatMessage }) => {
          const newMsg = payload.new
          setMessages((prev) => {
            // Dedup optimistic messages
            const exists = prev.some((m) => m.id === newMsg.id)
            if (exists) return prev
            return [...prev, newMsg as OptimisticMessage]
          })
          if (!isOpen && newMsg.sender_type !== 'GUEST') {
            setUnreadCount((c) => c + 1)
          }
          if (newMsg.sender_type === 'AI' || newMsg.sender_type === 'STAFF') {
            setIsTypingAi(false)
          }
        }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'guest_conversations',
          filter: `id=eq.${conversation.id}`,
        },
        (payload: { new: GuestConversation }) => {
          setConversation(payload.new)
          if (payload.new.status === 'RESOLVED') {
            setResolvedConvId(payload.new.id)
          }
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel

    // Fallback polling every 8s in case WebSocket drops
    pollTimerRef.current = setInterval(() => {
      loadConversation()
    }, 8000)

    return () => {
      supabase.removeChannel(channel)
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [conversation?.id, isOpen, loadConversation]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mark as read when opened ─────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && conversation?.id) {
      setUnreadCount(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(supabase as any)
        .from('guest_conversations')
        .update({ unread_guest_count: 0 })
        .eq('id', conversation.id)
        .then(() => {})
    }
  }, [isOpen, conversation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send message ─────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text?: string) => {
      const msgText = (text || inputText).trim()
      if (!msgText || isSending || !effectiveRoomId) return
      if (!hotelIdResolved) return

      const phone = getStoredGuestPhone()
      if (!phone) {
        setShowPhoneModal(true)
        return
      }

      const activeSessionId = getOrCreateGuestSessionId(effectiveRoomId)

      setInputText('')
      setIsSending(true)

      // Optimistic insert
      const optimisticId = `opt-${Date.now()}`
      const optimisticMsg: OptimisticMessage = {
        id: optimisticId,
        conversation_id: conversation?.id || '',
        hotel_id: hotelIdResolved,
        room_id: effectiveRoomId,
        sender_type: 'GUEST',
        sender_name: 'You',
        message_text: msgText,
        created_at: new Date().toISOString(),
        is_read: false,
        isOptimistic: true,
      }

      setMessages((prev) => [...prev, optimisticMsg])

      if (conversation?.status === 'BOT_ACTIVE') {
        setIsTypingAi(true)
      }

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation?.id || null,
            hotel_id: hotelIdResolved,
            room_id: effectiveRoomId,
            session_id: activeSessionId || null,
            guest_phone: phone || null,
            message_text: msgText,
            sender_name: 'Guest',
          }),
        })

        const data = await res.json()

        if (data?.conversation_id) {
          storeGuestConversationId(effectiveRoomId, data.conversation_id)
          if (!conversation?.id) {
            // Newly created conversation — load it
            await loadConversation()
          }
        }

        // Remove optimistic message (real one will arrive via Realtime)
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))

        // If AI reply included inline (non-realtime), add it
        if (data?.ai_reply) {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === data.ai_reply.id)
            if (exists) return prev
            return [...prev, data.ai_reply as OptimisticMessage]
          })
          setIsTypingAi(false)
        }
      } catch (err) {
        console.error('[GuestChat] Send error:', err)
        setIsTypingAi(false)
        // Revert optimistic message to error state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId
              ? { ...m, message_text: m.message_text + ' (failed to send)', isOptimistic: false }
              : m
          )
        )
      } finally {
        setIsSending(false)
      }
    },
    [inputText, isSending, effectiveRoomId, hotelIdResolved, conversation, loadConversation]
  )

  // ── Escalate to human staff ──────────────────────────────────────────────
  const handleEscalate = useCallback(async () => {
    if (!conversation?.id || !effectiveRoomId || isEscalating) return
    setIsEscalating(true)
    setShowEscalateConfirm(false)

    try {
      await fetch('/api/chat/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id,
          hotel_id: hotelIdResolved,
          room_id: effectiveRoomId,
          guest_message: 'Guest requested human assistance',
        }),
      })
      // Conversation status will update via Realtime
    } catch (err) {
      console.error('[GuestChat] Escalate error:', err)
    } finally {
      setIsEscalating(false)
    }
  }, [conversation?.id, effectiveRoomId, hotelIdResolved, isEscalating])

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isHandoff = conversation?.status === 'STAFF_HANDOFF'
  const isResolved = conversation?.status === 'RESOLVED' || resolvedConvId === conversation?.id

  if (!roomId) return null

  // ── Header title ─────────────────────────────────────────────────────────
  const headerTitle = isHandoff
    ? '🧑‍💼 Front Desk Staff'
    : '🤖 Kekehyu AI Concierge'

  const headerSubtitle = isHandoff
    ? 'A staff member has joined your chat'
    : isResolved
    ? 'Conversation resolved'
    : 'Powered by Kekehyu AI'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── FAB Button ──────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          bottom: '100px',
          right: '16px',
          zIndex: 50,
        }}
      >
        <button
          id="guest-chat-fab"
          aria-label="Open Chat"
          onClick={handleToggleChat}
          style={{
            position: 'relative',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            border: '2px solid rgba(251,191,36,0.6)',
            background: isOpen
              ? 'linear-gradient(135deg, #1e1b4b, #312e81)'
              : 'linear-gradient(135deg, #f59e0b, #fbbf24)',
            boxShadow: isOpen
              ? '0 8px 25px rgba(99,102,241,0.5)'
              : '0 8px 25px rgba(251,191,36,0.5)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            transition: 'all 0.3s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          {isOpen ? '✕' : '💬'}

          {/* Pulse ring */}
          {!isOpen && (
            <span
              style={{
                position: 'absolute',
                inset: '-4px',
                borderRadius: '50%',
                background: 'rgba(251,191,36,0.3)',
                animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Unread badge */}
          {unreadCount > 0 && !isOpen && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                background: '#ef4444',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
                minWidth: '20px',
                height: '20px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                border: '2px solid rgba(15,15,25,0.8)',
                animation: 'bounce 1s infinite',
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Chat Drawer ──────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          id="guest-chat-drawer"
          style={{
            position: 'fixed',
            bottom: '170px',
            right: '16px',
            width: 'min(380px, calc(100vw - 32px))',
            height: 'min(560px, calc(100vh - 200px))',
            borderRadius: '20px',
            background: 'rgba(10, 10, 20, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(251,191,36,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 49,
            animation: 'slideUp 0.25s ease-out',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px',
              background: isHandoff
                ? 'linear-gradient(135deg, rgba(79,70,229,0.4), rgba(99,102,241,0.3))'
                : 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(251,191,36,0.15))',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: isHandoff
                    ? 'linear-gradient(135deg, #4f46e5, #6366f1)'
                    : 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              >
                {isHandoff ? '🧑‍💼' : '🤖'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#f1f5f9',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {headerTitle}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                  {headerSubtitle}
                </div>
              </div>
            </div>

            {/* Status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: isResolved ? '#94a3b8' : isHandoff ? '#6366f1' : '#10b981',
                  boxShadow: `0 0 6px ${isResolved ? '#94a3b8' : isHandoff ? '#6366f1' : '#10b981'}`,
                }}
              />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {isResolved ? 'Resolved' : isHandoff ? 'Staff Active' : 'Online'}
              </span>
            </div>
          </div>

          {/* Messages */}
          <div
            id="guest-chat-messages"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.15) transparent',
            }}
          >
            {/* Welcome message */}
            {messages.length === 0 && (
              <div
                style={{
                  padding: '16px',
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  borderRadius: '14px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🤖</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fbbf24', marginBottom: '4px' }}>
                  Welcome to Kekehyu Hotel!
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                  I&apos;m your AI concierge. Ask me anything about dining, spa, amenities, or hotel services.
                </div>

                {/* Quick prompts */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginTop: '14px',
                    justifyContent: 'center',
                  }}
                >
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '20px',
                        border: '1px solid rgba(251,191,36,0.35)',
                        background: 'rgba(251,191,36,0.1)',
                        color: '#fbbf24',
                        fontSize: '11px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.sender_type === 'GUEST' ? 'flex-end' : msg.sender_type === 'SYSTEM' ? 'center' : 'flex-start',
                }}
              >
                {/* Sender name */}
                {msg.sender_type !== 'GUEST' && msg.sender_type !== 'SYSTEM' && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: '#64748b',
                      marginBottom: '3px',
                      paddingLeft: '4px',
                      fontWeight: 600,
                      letterSpacing: '0.03em',
                    }}
                  >
                    {msg.sender_type === 'AI' ? '🤖 Kekehyu AI' : `🧑‍💼 ${msg.sender_name}`}
                  </span>
                )}
                <div
                  style={{
                    padding: msg.sender_type === 'SYSTEM' ? '8px 14px' : '10px 14px',
                    ...getBubbleStyle(msg.sender_type, msg.isOptimistic),
                  }}
                >
                  <div style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>
                    {renderFormattedMessage(msg.message_text)}
                  </div>
                </div>
                {/* Timestamp */}
                {msg.sender_type !== 'SYSTEM' && (
                  <span style={{ fontSize: '10px', color: '#475569', marginTop: '3px', paddingLeft: '4px', paddingRight: '4px' }}>
                    {formatTime(msg.created_at)}
                  </span>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {isTypingAi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    padding: '10px 16px',
                    background: 'rgba(30,30,50,0.9)',
                    borderRadius: '18px 18px 18px 4px',
                    border: '1px solid rgba(139,92,246,0.2)',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#a78bfa',
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>AI is typing…</span>
              </div>
            )}

            {/* Resolved banner */}
            {isResolved && (
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(100,116,139,0.1)',
                  border: '1px solid rgba(100,116,139,0.2)',
                  borderRadius: '12px',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: '#94a3b8',
                }}
              >
                ✅ This conversation is resolved. Tap a quick prompt or type to start a new one.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Escalate to staff button (shown only when BOT_ACTIVE and not resolved) */}
          {!isHandoff && !isResolved && conversation?.id && (
            <div style={{ padding: '0 12px', marginBottom: '4px' }}>
              {showEscalateConfirm ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'rgba(79,70,229,0.12)',
                    borderRadius: '12px',
                    border: '1px solid rgba(99,102,241,0.25)',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#94a3b8', flex: 1 }}>
                    Connect to a human staff member?
                  </span>
                  <button
                    onClick={handleEscalate}
                    disabled={isEscalating}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#4f46e5',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {isEscalating ? '…' : 'Yes'}
                  </button>
                  <button
                    onClick={() => setShowEscalateConfirm(false)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(100,116,139,0.3)',
                      background: 'transparent',
                      color: '#64748b',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowEscalateConfirm(true)}
                  id="guest-chat-escalate-btn"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '10px',
                    border: '1px solid rgba(99,102,241,0.3)',
                    background: 'rgba(79,70,229,0.08)',
                    color: '#818cf8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                  }}
                >
                  🧑‍💼 Connect to Human Staff
                </button>
              )}
            </div>
          )}

          {/* Input area */}
          {!isResolved && (
            <div
              style={{
                padding: '12px',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-end',
              }}
            >
              <textarea
                ref={inputRef}
                id="guest-chat-input"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isHandoff ? 'Message the front desk…' : 'Ask me anything…'}
                rows={1}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '14px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#e2e8f0',
                  fontSize: '13.5px',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.4,
                  maxHeight: '100px',
                  overflowY: 'auto',
                }}
                onInput={(e) => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 100)}px`
                }}
              />
              <button
                id="guest-chat-send-btn"
                onClick={() => handleSend()}
                disabled={!inputText.trim() || isSending}
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  border: 'none',
                  background:
                    inputText.trim() && !isSending
                      ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
                      : 'rgba(100,116,139,0.2)',
                  color: inputText.trim() && !isSending ? '#1a1200' : '#475569',
                  fontSize: '18px',
                  cursor: inputText.trim() && !isSending ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {isSending ? '…' : '➤'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Phone Capture Modal for Chat Reachability ──────────────────── */}
      <PhoneCaptureModal
        isOpen={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onSuccess={handlePhoneSuccess}
        roomId={effectiveRoomId || ''}
        hotelId={hotelIdResolved}
        title="Contact Information"
        description="Please enter your mobile phone number in case the chat is disconnected or our staff needs to follow up on your request."
      />

      {/* ── CSS Animations ───────────────────────────────────────────────── */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  )
}
