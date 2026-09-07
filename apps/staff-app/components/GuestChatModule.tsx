import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { StaffUser } from './UserManagement'
import ActiveChatScreen, { GuestConversation } from './ActiveChatScreen'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch {
    return ''
  }
}

// ─── GuestChatModule ──────────────────────────────────────────────────────────

interface GuestChatModuleProps {
  activeStaffUser: StaffUser | null
  hotelId?: string
  webAppBaseUrl?: string
}

type ConvTab = 'STAFF_HANDOFF' | 'BOT_ACTIVE' | 'RESOLVED'

export default function GuestChatModule({
  activeStaffUser,
  hotelId = '00000000-0000-0000-0000-000000000001',
  webAppBaseUrl = 'https://hotel-qr-ordering-system-web.vercel.app',
}: GuestChatModuleProps) {
  const [conversations, setConversations] = useState<GuestConversation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ConvTab>('STAFF_HANDOFF')
  const [activeConversation, setActiveConversation] = useState<GuestConversation | null>(null)
  const [unreadHandoff, setUnreadHandoff] = useState(0)
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const loadConversations = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('guest_conversations')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('last_message_at', { ascending: false })
      .limit(50)

    if (data) {
      setConversations(data as GuestConversation[])
      const handoffUnread = (data as GuestConversation[])
        .filter((c) => c.status === 'STAFF_HANDOFF')
        .reduce((acc, c) => acc + (c.unread_staff_count || 0), 0)
      setUnreadHandoff(handoffUnread)
    }
    setIsLoading(false)
  }, [hotelId])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    const channel = supabase
      .channel('staff-conv-list')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'guest_conversations',
        filter: `hotel_id=eq.${hotelId}`,
      }, () => { loadConversations() })
      .subscribe()

    realtimeRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [hotelId, loadConversations])

  // ── Active chat screen ────────────────────────────────────────────────────
  if (activeConversation) {
    return (
      <ActiveChatScreen
        conversation={activeConversation}
        hotelId={hotelId}
        staffUserId={activeStaffUser?.id || ''}
        staffName={activeStaffUser?.name || 'Staff'}
        webAppBaseUrl={webAppBaseUrl}
        onBack={() => { setActiveConversation(null); loadConversations() }}
        onResolved={() => { setActiveConversation(null); loadConversations() }}
      />
    )
  }

  const TABS: { key: ConvTab; label: string; icon: string; color: string }[] = [
    { key: 'STAFF_HANDOFF', label: 'Active',   icon: '🙋', color: '#6366f1' },
    { key: 'BOT_ACTIVE',    label: 'AI Bot',   icon: '🤖', color: '#a78bfa' },
    { key: 'RESOLVED',      label: 'Resolved', icon: '✅', color: '#4ade80' },
  ]

  const filteredConvs = conversations.filter((c) => c.status === activeTab)

  return (
    <View style={styles.module}>
      {/* Module Header */}
      <View style={styles.moduleHeader}>
        <Text style={styles.moduleTitle}>💬 Guest Chat</Text>
        {unreadHandoff > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unreadHandoff > 99 ? '99+' : unreadHandoff}</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tab,
              activeTab === tab.key && { borderBottomColor: tab.color, borderBottomWidth: 2 },
            ]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab.key && { color: tab.color }]}>
              {tab.icon} {tab.label}
            </Text>
            {tab.key === 'STAFF_HANDOFF' && unreadHandoff > 0 && (
              <View style={[styles.tabBadge, { backgroundColor: tab.color }]}>
                <Text style={styles.tabBadgeText}>{unreadHandoff}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.loaderText}>Loading conversations…</Text>
        </View>
      ) : filteredConvs.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{TABS.find((t) => t.key === activeTab)?.icon ?? '💬'}</Text>
          <Text style={styles.emptyText}>
            {activeTab === 'STAFF_HANDOFF'
              ? 'No active handoffs'
              : activeTab === 'BOT_ACTIVE'
              ? 'No AI-managed chats'
              : 'No resolved conversations'}
          </Text>
          <Text style={styles.emptySubtext}>Conversations appear here in real-time</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {filteredConvs.map((conv) => (
            <TouchableOpacity
              key={conv.id}
              style={styles.convCard}
              onPress={() => setActiveConversation(conv)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.convAvatar,
                  {
                    backgroundColor:
                      conv.status === 'STAFF_HANDOFF'
                        ? 'rgba(99,102,241,0.15)'
                        : conv.status === 'BOT_ACTIVE'
                        ? 'rgba(167,139,250,0.15)'
                        : 'rgba(74,222,128,0.1)',
                  },
                ]}
              >
                <Text style={styles.convAvatarIcon}>
                  {conv.status === 'STAFF_HANDOFF' ? '🧑‍💼' : conv.status === 'BOT_ACTIVE' ? '🤖' : '✅'}
                </Text>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.convRow}>
                  <Text style={styles.convTitle} numberOfLines={1}>
                    {conv.guest_name || 'Guest'} · …{conv.room_id?.slice(-4).toUpperCase()}
                  </Text>
                  <Text style={styles.convTime}>{timeAgo(conv.last_message_at)}</Text>
                </View>
                <Text style={styles.convSnippet} numberOfLines={1}>
                  {conv.last_message_sender === 'AI'
                    ? '🤖 '
                    : conv.last_message_sender === 'STAFF'
                    ? '🧑‍💼 '
                    : '👤 '}
                  {conv.last_message_text || 'No messages yet'}
                </Text>
              </View>

              {(conv.unread_staff_count || 0) > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>{conv.unread_staff_count}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg: '#020617',
  surface: '#0f172a',
  surfaceLight: '#1e293b',
  border: 'rgba(255,255,255,0.08)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
  indigo: '#6366f1',
}

const styles = StyleSheet.create({
  module: {
    backgroundColor: C.surface,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.25)',
    overflow: 'hidden',
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  moduleTitle: { fontSize: 18, fontWeight: '800', color: C.textPrimary, flex: 1 },
  unreadBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 4,
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
  },
  tabText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  tabBadge: {
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  loader: { padding: 32, alignItems: 'center', gap: 10 },
  loaderText: { color: C.textSecondary, fontSize: 13 },
  emptyState: { padding: 32, alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 36, marginBottom: 4 },
  emptyText: { color: C.textSecondary, fontSize: 15, fontWeight: '600' },
  emptySubtext: { color: C.textMuted, fontSize: 12, textAlign: 'center' },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  convAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  convAvatarIcon: { fontSize: 20 },
  convRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  convTitle: { color: C.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  convTime: { color: C.textMuted, fontSize: 11, marginLeft: 8 },
  convSnippet: { color: C.textSecondary, fontSize: 12 },
  unreadPill: {
    backgroundColor: C.indigo,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  unreadPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
