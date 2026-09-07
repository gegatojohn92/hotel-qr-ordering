import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type GuestChatSenderType = 'GUEST' | 'AI' | 'STAFF' | 'SYSTEM'
export type ConversationStatus = 'BOT_ACTIVE' | 'STAFF_HANDOFF' | 'RESOLVED'

export interface GuestConversation {
  id: string
  hotel_id: string
  room_id: string
  guest_name: string | null
  status: ConversationStatus
  assigned_staff_id: string | null
  last_message_text: string | null
  last_message_sender: GuestChatSenderType | null
  last_message_at: string
  unread_staff_count: number
  unread_guest_count: number
  created_at: string
  updated_at: string
}

export interface GuestChatMessage {
  id: string
  conversation_id: string
  hotel_id: string
  room_id: string
  sender_type: GuestChatSenderType
  sender_staff_id: string | null
  sender_name: string
  message_text: string
  is_read: boolean
  created_at: string
}

export interface OptimisticMessage extends GuestChatMessage {
  isOptimistic?: boolean
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function getBubbleStyle(senderType: GuestChatSenderType, isOwnMsg: boolean) {
  if (isOwnMsg) {
    return {
      alignSelf: 'flex-end' as const,
      backgroundColor: '#4f46e5',
      borderRadius: 18,
      borderBottomRightRadius: 4,
      padding: 12,
      maxWidth: '80%' as const,
    }
  }
  switch (senderType) {
    case 'GUEST':
      return {
        alignSelf: 'flex-start' as const,
        backgroundColor: 'rgba(251,191,36,0.15)',
        borderColor: 'rgba(251,191,36,0.35)',
        borderWidth: 1,
        borderRadius: 18,
        borderBottomLeftRadius: 4,
        padding: 12,
        maxWidth: '80%' as const,
      }
    case 'AI':
      return {
        alignSelf: 'flex-start' as const,
        backgroundColor: 'rgba(139,92,246,0.15)',
        borderColor: 'rgba(139,92,246,0.3)',
        borderWidth: 1,
        borderRadius: 18,
        borderBottomLeftRadius: 4,
        padding: 12,
        maxWidth: '80%' as const,
      }
    case 'STAFF':
      return {
        alignSelf: 'flex-start' as const,
        backgroundColor: 'rgba(99,102,241,0.2)',
        borderRadius: 18,
        borderBottomLeftRadius: 4,
        padding: 12,
        maxWidth: '80%' as const,
      }
    case 'SYSTEM':
      return {
        alignSelf: 'center' as const,
        backgroundColor: 'rgba(100,116,139,0.15)',
        borderRadius: 12,
        padding: 8,
        maxWidth: '90%' as const,
      }
    default:
      return { alignSelf: 'flex-start' as const, padding: 12, maxWidth: '80%' as const }
  }
}

function getBubbleTextColor(senderType: GuestChatSenderType, isOwnMsg: boolean): string {
  if (isOwnMsg) return '#e0e7ff'
  if (senderType === 'GUEST') return '#fbbf24'
  if (senderType === 'AI') return '#c4b5fd'
  if (senderType === 'SYSTEM') return '#94a3b8'
  return '#e2e8f0'
}

export interface ActiveChatScreenProps {
  conversation: GuestConversation
  hotelId: string
  staffUserId: string
  staffName: string
  webAppBaseUrl: string
  onBack: () => void
  onResolved: () => void
}

export default function ActiveChatScreen({
  conversation,
  hotelId,
  staffUserId,
  staffName,
  webAppBaseUrl,
  onBack,
  onResolved,
}: ActiveChatScreenProps) {
  const [messages, setMessages] = useState<OptimisticMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [smartReplies, setSmartReplies] = useState<string[]>([])
  const [isLoadingSmartReplies, setIsLoadingSmartReplies] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const isHandoff = conversation.status === 'STAFF_HANDOFF'

  // ── Load messages ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('guest_chat_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(100)

    if (data) setMessages(data as OptimisticMessage[])
  }, [conversation.id])

  useEffect(() => { loadMessages() }, [loadMessages])

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`staff-chat-${conversation.id}`)
      .on('postgres_changes' as any, {
        event: 'INSERT',
        schema: 'public',
        table: 'guest_chat_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, (payload: { new: GuestChatMessage }) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.new.id)) return prev
          return [...prev, payload.new as OptimisticMessage]
        })
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
      })
      .subscribe()

    channelRef.current = ch
    pollRef.current = setInterval(loadMessages, 8000)

    return () => {
      supabase.removeChannel(ch)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [conversation.id, loadMessages])

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150)
    }
  }, [messages.length])

  // ── Smart replies ──────────────────────────────────────────────────────────
  const loadSmartReplies = useCallback(async () => {
    setIsLoadingSmartReplies(true)
    try {
      const url = Platform.OS === 'web'
        ? '/api/chat/ai-smart-replies'
        : `${webAppBaseUrl}/api/chat/ai-smart-replies`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversation.id }),
      })
      const data = await res.json()
      if (Array.isArray(data?.suggestions)) setSmartReplies(data.suggestions)
    } catch { /* ignore */ }
    finally { setIsLoadingSmartReplies(false) }
  }, [conversation.id, webAppBaseUrl])

  useEffect(() => {
    if (isHandoff) loadSmartReplies()
  }, [isHandoff, loadSmartReplies])

  // ── Mark staff unread ──────────────────────────────────────────────────────
  useEffect(() => {
    ;(supabase as any)
      .from('guest_conversations')
      .update({ unread_staff_count: 0 })
      .eq('id', conversation.id)
      .then(() => {})
  }, [conversation.id])

  // ── Claim ──────────────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    setIsClaiming(true)
    try {
      const url = Platform.OS === 'web' ? '/api/chat/handoff' : `${webAppBaseUrl}/api/chat/handoff`
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id,
          hotel_id: hotelId,
          room_id: conversation.room_id,
        }),
      })
      await (supabase as any)
        .from('guest_conversations')
        .update({ status: 'STAFF_HANDOFF', assigned_staff_id: staffUserId, updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
    } catch {
      Alert.alert('Error', 'Could not claim conversation.')
    } finally {
      setIsClaiming(false)
    }
  }, [conversation.id, conversation.room_id, hotelId, staffUserId, webAppBaseUrl])

  // ── Resolve ────────────────────────────────────────────────────────────────
  const handleResolve = useCallback(() => {
    Alert.alert('Mark as Resolved', 'This will end the conversation and notify the guest.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resolve',
        style: 'destructive',
        onPress: async () => {
          setIsResolving(true)
          try {
            const url = Platform.OS === 'web' ? '/api/chat/resolve' : `${webAppBaseUrl}/api/chat/resolve`
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conversation_id: conversation.id,
                hotel_id: hotelId,
                staff_user_id: staffUserId,
                staff_name: staffName,
              }),
            })
            onResolved()
          } catch {
            Alert.alert('Error', 'Could not resolve conversation.')
          } finally {
            setIsResolving(false)
          }
        },
      },
    ])
  }, [conversation.id, hotelId, onResolved, staffName, staffUserId, webAppBaseUrl])

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text?: string) => {
    const msgText = (text || inputText).trim()
    if (!msgText || isSending) return

    setInputText('')
    setIsSending(true)

    const optimisticId = `opt-staff-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        conversation_id: conversation.id,
        hotel_id: hotelId,
        room_id: conversation.room_id,
        sender_type: 'STAFF',
        sender_staff_id: staffUserId,
        sender_name: staffName,
        message_text: msgText,
        is_read: true,
        created_at: new Date().toISOString(),
        isOptimistic: true,
      } as OptimisticMessage,
    ])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)

    try {
      const { data: newMsg } = await (supabase as any)
        .from('guest_chat_messages')
        .insert({
          conversation_id: conversation.id,
          hotel_id: hotelId,
          room_id: conversation.room_id,
          sender_type: 'STAFF',
          sender_staff_id: staffUserId,
          sender_name: staffName,
          message_text: msgText,
          is_read: true,
        })
        .select('id, created_at')
        .single()

      await (supabase as any)
        .from('guest_conversations')
        .update({
          last_message_text: msgText,
          last_message_sender: 'STAFF',
          last_message_at: new Date().toISOString(),
          unread_guest_count: (conversation.unread_guest_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      setMessages((prev) =>
        prev.map((m) => m.id === optimisticId ? { ...m, id: newMsg?.id || m.id, isOptimistic: false } : m)
      )

      if (isHandoff) loadSmartReplies()
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      Alert.alert('Error', 'Message failed to send.')
    } finally {
      setIsSending(false)
    }
  }, [inputText, isSending, conversation, hotelId, staffUserId, staffName, isHandoff, loadSmartReplies])

  const statusColor = isHandoff ? '#6366f1' : conversation.status === 'RESOLVED' ? '#4ade80' : '#fbbf24'
  const statusLabel = isHandoff ? '🧑‍💼 Staff Active' : conversation.status === 'RESOLVED' ? '✅ Resolved' : '🤖 AI Bot'

  return (
    <View style={chatStyles.container}>
      {/* Header */}
      <View style={chatStyles.header}>
        <TouchableOpacity onPress={onBack} style={chatStyles.backBtn} activeOpacity={0.7}>
          <Text style={chatStyles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={chatStyles.headerTitle} numberOfLines={1}>
            💬 Room …{conversation.room_id?.slice(-4).toUpperCase()}
          </Text>
          <Text style={[chatStyles.headerStatus, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {conversation.status === 'BOT_ACTIVE' && (
          <TouchableOpacity
            style={[chatStyles.actionBtn, { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' }]}
            onPress={handleClaim}
            disabled={isClaiming}
            activeOpacity={0.8}
          >
            <Text style={[chatStyles.actionBtnText, { color: '#818cf8' }]}>{isClaiming ? '…' : '🙋 Claim'}</Text>
          </TouchableOpacity>
        )}
        {isHandoff && (
          <TouchableOpacity
            style={[chatStyles.actionBtn, { backgroundColor: 'rgba(74,222,128,0.12)', borderColor: '#4ade80' }]}
            onPress={handleResolve}
            disabled={isResolving}
            activeOpacity={0.8}
          >
            <Text style={[chatStyles.actionBtnText, { color: '#4ade80' }]}>{isResolving ? '…' : '✅ Resolve'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={chatStyles.messages}
        contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg, idx) => {
          const isOwnMsg = msg.sender_type === 'STAFF' && msg.sender_staff_id === staffUserId
          return (
            <View
              key={msg.id || `msg-${idx}`}
              style={{
                alignItems: msg.sender_type === 'SYSTEM' ? 'center' : isOwnMsg ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}
            >
              {msg.sender_type !== 'GUEST' && msg.sender_type !== 'SYSTEM' && !isOwnMsg && (
                <Text style={chatStyles.senderLabel}>
                  {msg.sender_type === 'AI' ? '🤖 Kekehyu AI' : `🧑‍💼 ${msg.sender_name}`}
                </Text>
              )}
              <View style={getBubbleStyle(msg.sender_type, isOwnMsg) as any}>
                <Text style={{ color: getBubbleTextColor(msg.sender_type, isOwnMsg), fontSize: 14, lineHeight: 20 }}>
                  {msg.message_text}
                </Text>
              </View>
              <Text style={chatStyles.timestamp}>{formatTime(msg.created_at)}</Text>
            </View>
          )
        })}
      </ScrollView>

      {/* AI Smart Reply Chips */}
      {isHandoff && (
        <View style={chatStyles.smartRepliesContainer}>
          <Text style={chatStyles.smartRepliesLabel}>
            {isLoadingSmartReplies ? '⟳ Loading suggestions…' : '⚡ AI Suggestions'}
          </Text>
          {smartReplies.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {smartReplies.map((reply, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={chatStyles.smartReplyChip}
                  onPress={() => setInputText(reply)}
                  activeOpacity={0.8}
                >
                  <Text style={chatStyles.smartReplyText} numberOfLines={1}>{reply}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Input */}
      {conversation.status !== 'RESOLVED' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={chatStyles.inputContainer}
        >
          <TextInput
            style={chatStyles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isHandoff ? 'Reply to guest…' : 'Claim conversation to reply…'}
            placeholderTextColor="#475569"
            multiline
            maxLength={1000}
            editable={isHandoff}
          />
          <TouchableOpacity
            style={[
              chatStyles.sendBtn,
              (!inputText.trim() || isSending || !isHandoff) && chatStyles.sendBtnDisabled,
            ]}
            onPress={() => handleSend()}
            disabled={!inputText.trim() || isSending || !isHandoff}
            activeOpacity={0.8}
          >
            <Text style={chatStyles.sendBtnText}>{isSending ? '…' : '➤'}</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      )}
    </View>
  )
}

const chatStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0d14',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
    marginBottom: 16,
    minHeight: 500,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0f1422',
    gap: 10,
  },
  backBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#172033',
  },
  backText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  headerTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  headerStatus: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, flexShrink: 0 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  messages: { flex: 1, backgroundColor: '#0a0d14' },
  senderLabel: { fontSize: 10, color: '#64748b', marginBottom: 3, paddingLeft: 4, fontWeight: '600' },
  timestamp: { fontSize: 10, color: '#64748b', marginTop: 2, paddingHorizontal: 4 },
  smartRepliesContainer: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0f1422',
  },
  smartRepliesLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  smartReplyChip: {
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.35)',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    maxWidth: 220,
  },
  smartReplyText: { color: '#818cf8', fontSize: 12, fontWeight: '600' },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0f1422',
    gap: 8,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#172033',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { backgroundColor: '#172033' },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
