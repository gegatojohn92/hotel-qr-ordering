import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  TextInput,
  Platform,
  Linking,
} from 'react-native'
import { supabase } from './lib/supabase'
import CallQueue from './components/CallQueue'
import SpaQueue from './components/SpaQueue'
import SpaTimetable from './components/SpaTimetable'
import FoodQueue from './components/FoodQueue'
import TaskQueue from './components/TaskQueue'
import FunctionRoomModule from './components/FunctionRoomModule'
import { StaffUser } from './components/UserManagement'
import DedicatedCallModule from './components/DedicatedCallModule'
import RequestHistory from './components/RequestHistory'
import IncomingRequestAlert, { type IncomingRequest } from './components/IncomingRequestAlert'
import IncomingLiveCallAlert from './components/IncomingLiveCallAlert'
import ActiveCallBar from './components/ActiveCallBar'
import { useStaffVoiceCall } from './lib/useStaffVoiceCall'
import PendingRequestsReminderModal, { type PendingRequestItem } from './components/PendingRequestsReminderModal'
import PushDiagnosticsModal, { type PushLogItem } from './components/PushDiagnosticsModal'
import {
  setupNotificationChannels,
  registerForPushNotifications,
  triggerAlarmNotification,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  bindPushTokenToStaffUser,
  clearPushTokenFromStaffUser,
  canRoleReceiveNotification,
  type NotificationSettings,
} from './lib/notifications'
import {
  createNotifeeChannels,
  startStaffMonitoringService,
  stopStaffMonitoringService,
  checkAndPromptBatteryOptimization,
  runBackgroundWatchdogCheck,
} from './lib/foregroundService'

import {
  saveStaffSession,
  getSavedStaffSession,
  clearStaffSession,
} from './lib/authStorage'
import { useAutoSync } from './lib/useAutoSync'
import { useAutoUpdate } from './lib/useAutoUpdate'

// ─── Global Error Boundary ───────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[App Global ErrorBoundary Captured]:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={errorStyles.safe}>
          <StatusBar barStyle="light-content" backgroundColor="#020617" />
          <View style={errorStyles.container}>
            <Text style={errorStyles.headerIcon}>⚠️</Text>
            <Text style={errorStyles.title}>Runtime Error Captured</Text>
            <Text style={errorStyles.subtitle}>
              An unexpected error occurred. The details below can help diagnose the issue:
            </Text>
            <ScrollView style={errorStyles.scroll} contentContainerStyle={errorStyles.scrollContent}>
              <Text style={errorStyles.errorText}>{this.state.error?.toString()}</Text>
              {this.state.error?.stack ? (
                <Text style={errorStyles.stackText}>{this.state.error.stack}</Text>
              ) : null}
            </ScrollView>
            <TouchableOpacity
              style={errorStyles.button}
              onPress={() => this.setState({ hasError: false, error: null })}
            >
              <Text style={errorStyles.buttonText}>Try Reloading App State</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    }

    return this.props.children
  }
}

const errorStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f87171',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
  },
  scroll: {
    width: '100%',
    maxHeight: 300,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 20,
  },
  scrollContent: {
    padding: 14,
  },
  errorText: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 10,
  },
  stackText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  button: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: '#020617',
    fontWeight: '800',
    fontSize: 14,
  },
})

// ─── Types ───────────────────────────────────────────────────

type ConnectionStatus = 'connecting' | 'connected' | 'error'

interface HotelInfo {
  name: string
  count: number
}

// ─── Constants ───────────────────────────────────────────────

const { width } = Dimensions.get('window')

// ─── Colors ──────────────────────────────────────────────────

const COLORS = {
  bg: '#020617',
  surface: '#0f172a',
  surfaceLight: '#1e293b',
  border: 'rgba(255,255,255,0.08)',
  gold: '#fbbf24',
  goldDark: '#d97706',
  goldMuted: 'rgba(251,191,36,0.12)',
  green: '#4ade80',
  greenMuted: 'rgba(74,222,128,0.12)',
  red: '#f87171',
  redMuted: 'rgba(248,113,113,0.12)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
}

// ─── Status Badge ─────────────────────────────────────────────

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (status === 'connected') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start()
    }
  }, [status, pulseAnim])

  const configs = {
    connecting: {
      label: 'Connecting...',
      color: COLORS.gold,
      bg: COLORS.goldMuted,
      borderColor: 'rgba(251,191,36,0.3)',
    },
    connected: {
      label: '✓ Connected to Supabase',
      color: COLORS.green,
      bg: COLORS.greenMuted,
      borderColor: 'rgba(74,222,128,0.3)',
    },
    error: {
      label: '✕ Connection Failed',
      color: COLORS.red,
      bg: COLORS.redMuted,
      borderColor: 'rgba(248,113,113,0.3)',
    },
  }

  const cfg = configs[status]

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg, borderColor: cfg.borderColor },
      ]}
    >
      {status === 'connecting' ? (
        <ActivityIndicator size="small" color={cfg.color} style={{ marginRight: 8 }} />
      ) : (
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: cfg.color, transform: [{ scale: pulseAnim }] },
          ]}
        />
      )}
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

// ─── Stat Card ────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

// ─── App Root Component Wrapped with ErrorBoundary ───────────

export default function App() {
  return (
    <ErrorBoundary>
      <MainAppContent />
    </ErrorBoundary>
  )
}

// ─── Main App Content ────────────────────────────────────────

function MainAppContent() {
  // Check and apply OTA updates automatically on launch & foreground resume
  useAutoUpdate()

  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [hotelInfo, setHotelInfo] = useState<HotelInfo | null>(null)
  const [roomCount, setRoomCount] = useState<number>(0)
  const [pendingCalls, setPendingCalls] = useState(0)
  const [pendingSpa, setPendingSpa] = useState(0)
  const [pendingFood, setPendingFood] = useState(0)
  const [pendingTasks, setPendingTasks] = useState(0)
  const [totalRequests, setTotalRequests] = useState(0)
  const [resolvedToday, setResolvedToday] = useState(0)
  const [activeStaffUser, setActiveStaffUser] = useState<StaffUser | null>(null)
  const activeStaffUserRef = useRef<StaffUser | null>(null)
  useEffect(() => {
    activeStaffUserRef.current = activeStaffUser
  }, [activeStaffUser])
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  const [incomingAlert, setIncomingAlert] = useState<IncomingRequest | null>(null)
  const [incomingCallQueue, setIncomingCallQueue] = useState<
    Array<{
      requestId: string
      roomNumber: string
      channel: string
    }>
  >([])
  const [activeCallRoom, setActiveCallRoom] = useState<string | null>(null)
  const [activeCallRequestId, setActiveCallRequestId] = useState<string | null>(null)

  const enqueueLiveCall = useCallback(
    (call: { requestId: string; roomNumber: string; channel: string }) => {
      setIncomingCallQueue((prev) => {
        if (prev.some((c) => c.requestId === call.requestId)) return prev
        return [...prev, call]
      })
    },
    []
  )

  const dequeueLiveCall = useCallback((reqId: string) => {
    setIncomingCallQueue((prev) => prev.filter((c) => c.requestId !== reqId))
  }, [])

  // EXPO_PUBLIC_ vars are inlined at Metro/webpack build time.
  // On Vercel, set EXPO_PUBLIC_AGORA_APP_ID in the project env settings.
  // The hardcoded value here is the fallback so the web build never gets an empty string.
  const AGORA_APP_ID =
    process.env.EXPO_PUBLIC_AGORA_APP_ID ||
    'c2e5d50d9273492d874b2a898f458334'

  // Base URL of the deployed guest/admin web app (Next.js on Vercel).
  // Native Android/iOS builds cannot use relative fetch paths, so all
  // /api/* calls from the native app must be prefixed with this URL.
  // Override via EXPO_PUBLIC_WEB_URL if the domain ever changes.
  const WEB_APP_BASE_URL = (
    process.env.EXPO_PUBLIC_WEB_URL ||
    'https://hotel-qr-ordering-system-web.vercel.app'
  ).replace(/\/+$/, '')

  const staffVoiceCall = useStaffVoiceCall({
    onCallEnded: () => {
      setActiveCallRoom(null)
      setActiveCallRequestId(null)
    },
  })

  const handleAnswerLiveCall = useCallback(
    async (channel: string, reqId: string) => {
      try {
        const staffUserId = activeStaffUserRef.current?.id || null

        // Concurrency Guard: Atomic update check to ensure only ONE staff member claims the call
        const { data: claimData, error: claimError } = await supabase
          .from('requests')
          .update({
            status: 'LIVE',
            claimed_by_staff_id: staffUserId,
            call_started_at: new Date().toISOString(),
          } as any)
          .eq('id', reqId)
          .eq('status', 'PENDING')
          .select()

        if (claimError || !claimData || (claimData as any[]).length === 0) {
          // Already claimed by another staff member or cancelled by guest
          dequeueLiveCall(reqId)
          Alert.alert(
            'Call Unavailable',
            'This call was already answered by another staff member or cancelled by the guest.'
          )
          return
        }

        dequeueLiveCall(reqId)
        setActiveCallRequestId(reqId)

        // Lookup room number for display
        const { data: req } = await supabase
          .from('requests')
          .select('*, rooms(room_number)')
          .eq('id', reqId)
          .maybeSingle()

        const roomNum =
          (req?.rooms as any)?.room_number ||
          (req?.payload as any)?.room_number ||
          'Guest'
        setActiveCallRoom(String(roomNum))

        // Native platforms cannot resolve relative URLs — always use the
        // absolute deployed web URL there. Web builds keep the relative path
        // so the staff PWA stays same-origin (no CORS needed).
        const tokenUrl = Platform.OS === 'web'
          ? `/api/agora/token?channel=${encodeURIComponent(channel)}&uid=2`
          : `${WEB_APP_BASE_URL}/api/agora/token?channel=${encodeURIComponent(channel)}&uid=2`

        const tokenRes = await fetch(tokenUrl)
        const tokenData = await tokenRes.json()

        if (!tokenRes.ok || !tokenData?.token) {
          throw new Error(tokenData?.error || 'Missing Agora token')
        }

        // Join Agora voice channel as staff (UID 2)
        await staffVoiceCall.joinChannel(channel, tokenData.token, AGORA_APP_ID)
      } catch (err: any) {
        console.error('[App] Answer live call error:', err)
        Alert.alert('Call Failed', `Could not connect to live voice call.\n${err?.message || err || 'Unknown error'}`)
        setActiveCallRoom(null)
        setActiveCallRequestId(null)
      }
    },
    [AGORA_APP_ID, WEB_APP_BASE_URL, staffVoiceCall, dequeueLiveCall]
  )

  const handleDeclineLiveCall = useCallback(async (reqId: string) => {
    dequeueLiveCall(reqId)
    try {
      await supabase
        .from('requests')
        .update({
          status: 'DECLINED',
          call_ended_at: new Date().toISOString(),
        } as any)
        .eq('id', reqId)
    } catch (err) {
      console.warn('[App] Decline live call error:', err)
    }
  }, [dequeueLiveCall])

  const handleEndStaffCall = useCallback(async () => {
    const reqId = activeCallRequestId
    await staffVoiceCall.leaveChannel()
    setActiveCallRoom(null)
    setActiveCallRequestId(null)
    if (reqId) {
      await supabase
        .from('requests')
        .update({
          status: 'RESOLVED',
          call_ended_at: new Date().toISOString(),
        } as any)
        .eq('id', reqId)
    }
  }, [activeCallRequestId, staffVoiceCall])

  const [unhandledPendingList, setUnhandledPendingList] = useState<PendingRequestItem[] | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const fadeAnim = React.useRef(new Animated.Value(0)).current
  const slideAnim = React.useRef(new Animated.Value(30)).current
  const lastDismissedReminderAtRef = React.useRef<number>(0)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null)
  const notificationSettingsRef = useRef<NotificationSettings | null>(null)
  const [fnbPhoneNumber, setFnbPhoneNumber] = useState<string | null>(null)
  useEffect(() => {
    notificationSettingsRef.current = notificationSettings
  }, [notificationSettings])

  const alertedRequestIdsRef = useRef<Set<string>>(new Set())

  const HOTEL_ID = '00000000-0000-0000-0000-000000000001'

  const fetchFnbPhoneNumber = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('hotels')
        .select('fnb_phone_number')
        .eq('id', HOTEL_ID)
        .maybeSingle()

      if (!error && data?.fnb_phone_number) {
        setFnbPhoneNumber(String(data.fnb_phone_number))
      } else {
        setFnbPhoneNumber(null)
      }
    } catch (err) {
      console.warn('[App] fetchFnbPhoneNumber error:', err)
      setFnbPhoneNumber(null)
    }
  }, [HOTEL_ID])

  // ─── Fetch Hotel Notification Settings ───────────────────────
  const fetchNotificationSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('hotel_id', HOTEL_ID)
        .maybeSingle()
      if (!error && data) {
        setNotificationSettings(data as NotificationSettings)
      }
    } catch (err) {
      console.warn('[App] fetchNotificationSettings caught:', err)
    }
  }, [HOTEL_ID])

  // ─── Web-Only: Supabase Realtime Listener for LIVE_CALL ───────
  // On web, FCM push doesn't deliver. Use Realtime to detect new LIVE_CALL requests.
  useEffect(() => {
    if (Platform.OS !== 'web') return

    const realtimeChannel = supabase
      .channel('web-live-call-listener')
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'requests',
        },
        async (payload: any) => {
          const req = payload.new
          if (!req?.id || req.request_type !== 'LIVE_CALL') return
          if (alertedRequestIdsRef.current.has(req.id)) return
          alertedRequestIdsRef.current.add(req.id)

          const ch = req.agora_channel || req.payload?.channel || `room-${req.room_id}`
          const rN = req.payload?.room_number || 'Guest'
          enqueueLiveCall({
            requestId: req.id,
            roomNumber: String(rN),
            channel: ch,
          })
          setRefreshKey((k) => k + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(realtimeChannel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-Login / Restore Saved Session on App Startup ──────
  useEffect(() => {
    let isMounted = true

    async function restoreSession() {
      try {
        fetchNotificationSettings()
        const savedUser = await getSavedStaffSession()
        if (savedUser && isMounted) {
          setActiveStaffUser(savedUser)

          // Background validation to ensure account is still active in database
          try {
            const { data } = await supabase
              .from('staff_users')
              .select('id, full_name, role, is_active')
              .eq('id', savedUser.id)
              .maybeSingle()

            if (isMounted) {
              if (data && data.is_active === false) {
                // Account was deactivated by administrator
                await clearStaffSession()
                setActiveStaffUser(null)
              } else if (data) {
                // Update local session with any fresh profile data
                const updatedUser: StaffUser = {
                  id: savedUser.id,
                  name: data.full_name || savedUser.name,
                  email: savedUser.email,
                  role: data.role || savedUser.role,
                }
                setActiveStaffUser(updatedUser)
                await saveStaffSession(updatedUser)
              }
            }
          } catch {
            // Network error or offline: keep user logged in with cached session
          }
        }
      } catch (err) {
        console.warn('[App] Session restoration error:', err)
      } finally {
        if (isMounted) {
          setIsRestoringSession(false)
        }
      }
    }

    restoreSession()

    return () => {
      isMounted = false
    }
  }, [fetchNotificationSettings])

  // ─── Dynamic Recurring Check for Unhandled Requests ─────────
  const checkUnhandledRequests = useCallback(async (isScheduledOrInitial = false) => {
    try {
      const settings = notificationSettingsRef.current
      const intervalMins = settings?.reminder_interval_minutes ?? 5
      // If reminder interval is disabled (0), skip recurring reminders
      if (intervalMins <= 0) {
        setUnhandledPendingList(null)
        return
      }

      const now = Date.now()
      const timeSinceDismissed = now - lastDismissedReminderAtRef.current
      const intervalMs = intervalMins * 60 * 1000
      if (!isScheduledOrInitial && timeSinceDismissed < intervalMs) {
        return
      }

      const userRole = activeStaffUserRef.current?.role
      const allTypes = ['CALL_REQUEST', 'SPA_BOOKING', 'TASK', 'FOOD_ORDER']
      const allowedTypes = allTypes.filter((t) => canRoleReceiveNotification(userRole, t, settings))

      if (allowedTypes.length === 0) {
        setUnhandledPendingList(null)
        return
      }

      const { data, error } = await supabase
        .from('requests')
        .select('id, request_type, status, payload, created_at, room_id, rooms(room_number)')
        .eq('hotel_id', HOTEL_ID)
        .in('request_type', allowedTypes)
        .in('status', ['PENDING', 'PENDING_ON_CALL'])
        .order('created_at', { ascending: true })

      if (error) {
        console.warn('[PendingReminder] Failed to query unhandled requests:', error)
        return
      }

      if (data && data.length > 0) {
        if (isScheduledOrInitial || timeSinceDismissed >= intervalMs) {
          setUnhandledPendingList(data as PendingRequestItem[])
          // Trigger aggressive alarm notification if on mobile/tablet
          if (Platform.OS !== 'web' && settings?.enable_sound_alert !== false) {
            triggerAlarmNotification({
              title: `${data.length} Unhandled Requests Pending`,
              body: `Reminder: ${data.length} pending guest requests require staff attention!`,
              requestId: data[0].id,
              roomNumber: 'Multiple Rooms',
              requestType: 'PENDING_REMINDER',
            })
          }
        }
      } else {
        setUnhandledPendingList(null)
      }
    } catch (err) {
      console.warn('[PendingReminder] Check error:', err)
    }
  }, [HOTEL_ID])

  const fetchStats = async () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [callsRes, spaRes, foodRes, taskRes, totalRes, resolvedRes] = await Promise.all([
      // Pending call requests
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID).eq('request_type', 'CALL_REQUEST').eq('status', 'PENDING'),
      // Pending spa bookings
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID).eq('request_type', 'SPA_BOOKING')
        .in('status', ['PENDING', 'PENDING_ON_CALL']),
      // Pending food orders
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID).eq('request_type', 'FOOD_ORDER')
        .in('status', ['PENDING', 'PREPARING']),
      // Pending room tasks
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID).eq('request_type', 'TASK')
        .in('status', ['PENDING', 'CLAIMED']),
      // Total active requests today
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID).gte('created_at', todayStart.toISOString()),
      // Resolved today
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('hotel_id', HOTEL_ID)
        .in('status', ['RESOLVED', 'CONFIRMED', 'DECLINED', 'CLAIMED', 'CANCELLED'])
        .gte('created_at', todayStart.toISOString()),
    ])

    setPendingCalls(callsRes.count ?? 0)
    setPendingSpa(spaRes.count ?? 0)
    setPendingFood(foodRes.count ?? 0)
    setPendingTasks(taskRes.count ?? 0)
    setTotalRequests(totalRes.count ?? 0)
    setResolvedToday(resolvedRes.count ?? 0)
  }

  const fetchData = async () => {
    setStatus('connecting')

    try {
      // Check hotels
      const { data: hotels, error: hotelError } = await supabase
        .from('hotels')
        .select('id, name')
        .limit(1)
        .single()

      await fetchFnbPhoneNumber()

      if (hotelError) throw hotelError

      // Count rooms
      const { count: rooms } = await supabase
        .from('rooms')
        .select('id', { count: 'exact', head: true })

      setHotelInfo({ name: hotels.name, count: 1 })
      setRoomCount(rooms ?? 0)
      setStatus('connected')

      // Fetch live stats
      await fetchStats()

      // Animate in
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start()
    } catch {
      setStatus('error')
    }
  }

  const hydrateIncomingAlert = async (request: any): Promise<IncomingRequest | null> => {
    if (!request) return null

    const payload = request.payload || {}
    const roomFromPayload =
      payload.room_number ??
      payload.room ??
      payload.room_no ??
      payload.roomNumber ??
      ''

    let roomNumber = typeof roomFromPayload === 'string' && roomFromPayload.trim() ? roomFromPayload.trim() : ''

    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)

    if ((!roomNumber || isUuid(roomNumber)) && request.room_id) {
      const { data: roomData } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', request.room_id)
        .maybeSingle()

      if (roomData?.room_number) {
        roomNumber = String(roomData.room_number)
      }
    }

    return {
      ...request,
      rooms: { room_number: roomNumber || '—' },
      payload: {
        ...payload,
        room_number: roomNumber || '—',
      },
    }
  }

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true)
    setLoginError('')

    try {
      const email = loginEmail.trim().toLowerCase()
      const password = loginPassword.trim()

      if (!email || !password) {
        throw new Error('Enter both email and password.')
      }

      const { data, error } = await supabase
        .from('staff_users')
        .select('id, full_name, email, role, password, is_active')
        .eq('email', email)
        .maybeSingle()

      if (error) {
        if (error.code === '42501' || error.code === 'PGRST301') {
          throw new Error('Staff login lookup is blocked by Supabase RLS. The staff_users table must allow public credential checks.')
        }

        throw error
      }

      if (!data || data.is_active !== true) {
        throw new Error('Invalid credentials. Please check your email and password.')
      }

      if (data.password !== password) {
        throw new Error('Invalid credentials. Please check your email and password.')
      }

      const userObj: StaffUser = {
        id: data.id,
        name: data.full_name,
        email: data.email,
        role: data.role,
      }
      setActiveStaffUser(userObj)
      await saveStaffSession(userObj)
      setLoginError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to log in.'
      setLoginError(message)
      setActiveStaffUser(null)
    } finally {
      setIsLoggingIn(false)
    }
  }, [loginEmail, loginPassword])

  const handleLogout = async () => {
    if (activeStaffUser?.id) {
      await clearPushTokenFromStaffUser(supabase, activeStaffUser.id)
    }
    try {
      await clearStaffSession()
    } catch (err) {
      console.warn('[App] Logout clear session error:', err)
    }
    stopStaffMonitoringService().catch(() => {})
    setActiveStaffUser(null)
    setLoginPassword('')
    setLoginError('')
  }

  const [refreshKey, setRefreshKey] = useState(0)

  // ─── Push Diagnostics & Real-time Logs ────────────────────────
  const [pushToken, setPushToken] = useState<string | null>(null)
  const [pushLogs, setPushLogs] = useState<PushLogItem[]>([])
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false)

  const handleTriggerTestAlarm = useCallback(() => {
    triggerAlarmNotification({
      title: 'Local Test Alarm',
      body: 'Testing ALARM audio stream, full-screen intent & vibration on device.',
      requestId: `test-${Date.now()}`,
      roomNumber: 'Test 888',
      requestType: 'TEST_ALARM',
    })
    setPushLogs((prev) => [
      {
        id: `local-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        title: '🔔 Local Test Alarm Triggered',
        body: 'Fired full-screen intent, audio stream & vibration test.',
        isTest: true,
      },
      ...prev.slice(0, 19),
    ])
  }, [])

  // ─── Notification Channels & Foreground Service Setup ────────
  // MUST run on mount (before any request arrives), not gated behind login.
  // Creates both the ALARM-stream and MONITOR channels.
  useEffect(() => {
    if (Platform.OS === 'web') return

    setupNotificationChannels()
      .catch((err) => console.warn('[App] setupNotificationChannels:', err))

    createNotifeeChannels()
      .catch((err) => console.warn('[App] createNotifeeChannels:', err))

    registerForPushNotifications()
      .then((token) => {
        if (token) setPushToken(token)
        if (!token && Platform.OS === 'android') {
          Alert.alert(
            '🔔 Enable Notifications',
            'Notifications are required to receive incoming guest requests. Please go to Settings → App → Notifications and enable them.',
            [{ text: 'OK' }]
          )
        }
      })
      .catch((err) => console.warn('[App] registerForPushNotifications:', err))

    const subResponse = addNotificationResponseListener(async (data) => {
      const isTest = Boolean(data?.isTestPush)
      const title = data?.title || (isTest ? '⚡ FCM High-Priority Push (Tapped)' : '🚨 Incoming Request (Tapped)')
      const body = data?.body || (data?.roomNumber ? `Room ${data.roomNumber}` : 'Guest notification tapped')

      setPushLogs((prev) => [
        {
          id: `resp-${Date.now()}-${Math.random()}`,
          timestamp: new Date().toLocaleTimeString(),
          title: String(title),
          body: String(body),
          isTest,
        },
        ...prev.slice(0, 19),
      ])

      if (isTest) {
        Alert.alert(
          '⚡ High-Priority FCM Push Tapped!',
          `FCM High-Priority push was tapped at ${new Date().toLocaleTimeString()}.\n\nBackground delivery is functioning properly!`,
          [{ text: 'OK' }]
        )
      }

      if (data?.requestId && !isTest) {
        setRefreshKey((k) => k + 1)
        try {
          const { data: req } = await supabase
            .from('requests')
            .select('*, rooms(room_number)')
            .eq('id', data.requestId)
            .maybeSingle()
          if (req) {
            if (req.request_type === 'LIVE_CALL') {
              const ch = data?.agoraChannel || req.agora_channel || (req.payload as any)?.channel || `room-${req.room_id}`
              const rN = (req.rooms as any)?.room_number || (req.payload as any)?.room_number || 'Room'
              enqueueLiveCall({
                requestId: req.id,
                roomNumber: String(rN),
                channel: ch,
              })
              return
            }
            const nextReq = await hydrateIncomingAlert(req)
            if (nextReq) {
              setIncomingAlert(nextReq)
            }
          }
        } catch {
          // ignore
        }
      }
    })

    const subReceived = addNotificationReceivedListener(async (notif) => {
      const data = notif?.request?.content?.data
      const isTest = Boolean(data?.isTestPush)
      const title = notif?.request?.content?.title || (isTest ? '⚡ FCM High-Priority Push' : '🚨 Incoming Request')
      const body = notif?.request?.content?.body || (data?.roomNumber ? `Room ${data.roomNumber}` : 'Notification received')

      setPushLogs((prev) => [
        {
          id: `recv-${Date.now()}-${Math.random()}`,
          timestamp: new Date().toLocaleTimeString(),
          title: String(title),
          body: String(body),
          isTest,
        },
        ...prev.slice(0, 19),
      ])

      if (isTest) {
        Alert.alert(
          '⚡ High-Priority FCM Push Received!',
          `Your Android device received the FCM High-Priority push test at ${new Date().toLocaleTimeString()}!`,
          [{ text: 'Great!' }]
        )
      }

      if (data?.requestId && !isTest) {
        setRefreshKey((k) => k + 1)
        try {
          const { data: req } = await supabase
            .from('requests')
            .select('*, rooms(room_number)')
            .eq('id', data.requestId)
            .maybeSingle()
          if (req) {
            if (req.request_type === 'LIVE_CALL') {
              const ch = data?.agoraChannel || req.agora_channel || (req.payload as any)?.channel || `room-${req.room_id}`
              const rN = (req.rooms as any)?.room_number || (req.payload as any)?.room_number || 'Room'
              enqueueLiveCall({
                requestId: req.id,
                roomNumber: String(rN),
                channel: ch,
              })
              return
            }
            const nextReq = await hydrateIncomingAlert(req)
            if (nextReq) {
              setIncomingAlert(nextReq)
            }
          }
        } catch {
          // ignore
        }
      }
    })

    return () => {
      subResponse.remove()
      subReceived.remove()
    }
  }, []) // ← empty deps: runs ONCE at mount, before login

  // ─── Start Foreground Service & Update push token on login ────
  useEffect(() => {
    if (Platform.OS === 'web') return

    if (activeStaffUser) {
      // Prompt staff to disable battery optimization for reliable 24/7 background execution
      checkAndPromptBatteryOptimization().catch((err) => {
        console.warn('[App] Battery optimization check caught:', err)
      })

      // Start 24/7 background monitoring service to keep WebSocket alive when screen is off
      startStaffMonitoringService(HOTEL_ID).catch((err) => {
        console.warn('[App] startStaffMonitoringService error:', err)
      })

      registerForPushNotifications()
        .then(async (token) => {
          if (token && activeStaffUser?.id) {
            setPushToken(token)
            await bindPushTokenToStaffUser(supabase, activeStaffUser.id, token)
          }
        })
        .catch((err) => {
          console.warn('[App] Push token DB update caught:', err)
        })
    } else {
      stopStaffMonitoringService().catch(() => {})
    }
  }, [activeStaffUser?.id])

  // ─── Dynamic Recurring Interval for Unhandled Pending Requests ──
  useEffect(() => {
    if (!activeStaffUser) return

    const intervalMins = notificationSettings?.reminder_interval_minutes ?? 5
    if (intervalMins <= 0) {
      setUnhandledPendingList(null)
      return
    }

    // Run check immediately on login / mount
    checkUnhandledRequests(true)

    // Setup dynamic recurring timer
    const timer = setInterval(() => {
      checkUnhandledRequests(true)
    }, intervalMins * 60 * 1000)

    return () => clearInterval(timer)
  }, [activeStaffUser, checkUnhandledRequests, notificationSettings?.reminder_interval_minutes])

  // ─── Automated Polling & Focus Synchronization for Top-Level Stats & Queues ──
  useAutoSync(
    useCallback(() => {
      if (activeStaffUser) {
        fetchStats()
        setRefreshKey((k) => k + 1)
        checkUnhandledRequests(false)
      }
    }, [activeStaffUser, checkUnhandledRequests]),
    { intervalMs: 6000, enabled: !!activeStaffUser }
  )

  const [isManualSyncing, setIsManualSyncing] = useState(false)
  const handleManualSync = useCallback(async () => {
    setIsManualSyncing(true)
    try {
      await fetchStats()
      setRefreshKey((k) => k + 1)
    } finally {
      setTimeout(() => setIsManualSyncing(false), 400)
    }
  }, [])

  const handleCallFnb = useCallback(async () => {
    if (!fnbPhoneNumber) {
      Alert.alert('F&B Number Missing', 'No direct F&B phone number is configured for this hotel yet.')
      return
    }

    try {
      await Linking.openURL(`tel:${fnbPhoneNumber}`)
    } catch (err) {
      console.warn('[App] open F&B dialer error:', err)
      Alert.alert('Dialer Error', 'Unable to open the phone dialer for the F&B number.')
    }
  }, [fnbPhoneNumber])

  useEffect(() => {
    fetchData()

    // 1. Subscribe to notification_settings changes
    const settingsChannel = supabase
      .channel('app-notification-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_settings' }, (payload) => {
        if (payload.new) {
          setNotificationSettings(payload.new as NotificationSettings)
        }
      })
      .subscribe()

    // 2. Subscribe to ALL requests changes to keep stats and queues live
    const channel = supabase
      .channel('app-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, (payload) => {
        fetchStats()
        setRefreshKey(k => k + 1)
        // If an update or deletion resolved pending items, silently update active reminder list and call queue
        if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
          const targetId = (payload.new as any)?.id || (payload.old as any)?.id
          const newStatus = (payload.new as any)?.status
          if (targetId && (newStatus === 'RESOLVED' || newStatus === 'CANCELLED' || newStatus === 'DECLINED' || payload.eventType === 'DELETE')) {
            dequeueLiveCall(targetId)
          }
          setUnhandledPendingList((prev) => {
            if (!prev) return null
            const updated = prev.filter(
              (item) => item.id !== (payload.new as any)?.id && item.id !== (payload.old as any)?.id
            )
            return updated.length > 0 ? updated : null
          })
        }
        // Fire aggressive alert on every new PENDING or PENDING_ON_CALL request
        const isNewPending = (payload.new as any)?.status === 'PENDING' || (payload.new as any)?.status === 'PENDING_ON_CALL'
        const reqType = (payload.new as any)?.request_type
        const userRole = activeStaffUserRef.current?.role
        const reqId = (payload.new as any)?.id

        if (payload.eventType === 'INSERT' && isNewPending && reqId) {
          // Role-based notification permission check
          if (!canRoleReceiveNotification(userRole, reqType, notificationSettingsRef.current)) {
            return
          }

          // Alert deduplication: suppress duplicate alarm triggers for the same request ID
          if (alertedRequestIdsRef.current.has(reqId)) {
            return
          }
          alertedRequestIdsRef.current.add(reqId)
          if (alertedRequestIdsRef.current.size > 200) {
            const arr = Array.from(alertedRequestIdsRef.current)
            alertedRequestIdsRef.current = new Set(arr.slice(-100))
          }

          if (reqType === 'LIVE_CALL') {
            const ch = (payload.new as any)?.agora_channel || (payload.new as any)?.payload?.channel || `room-${(payload.new as any)?.room_id}`
            const rNum = (payload.new as any)?.payload?.room_number || 'Room'
            enqueueLiveCall({
              requestId: reqId,
              roomNumber: String(rNum),
              channel: ch,
            })
            if (notificationSettingsRef.current?.enable_sound_alert !== false) {
              triggerAlarmNotification({
                title: '📞 Incoming Live Voice Call',
                body: `Room ${rNum} is calling live! Tap to answer.`,
                requestId: reqId,
                roomNumber: String(rNum),
                requestType: 'LIVE_CALL',
                payloadData: (payload.new as any)?.payload,
              })
            }
            return
          }

          hydrateIncomingAlert(payload.new as any)
            .then((nextRequest) => {
              if (nextRequest) {
                setIncomingAlert(nextRequest as IncomingRequest)
                // Fire aggressive Full-Screen Intent alarm (Notifee: wakes screen, loops alarm)
                const rType = nextRequest.request_type || 'REQUEST'
                const rNum = (nextRequest.payload as any)?.room_number || 'Room'
                const soundEnabled = notificationSettingsRef.current?.enable_sound_alert !== false
                if (soundEnabled) {
                  triggerAlarmNotification({
                    title: `Incoming ${rType.replace('_', ' ')}`,
                    body: `${rNum} submitted a new request requiring immediate staff attention!`,
                    requestId: nextRequest.id,
                    roomNumber: rNum,
                    requestType: rType,
                    payloadData: nextRequest.payload as any,
                  })
                }
              }
            })
            .catch(() => {
              setIncomingAlert(payload.new as IncomingRequest)
            })
        }
      })
      .subscribe((subStatus) => {
        if (subStatus === 'SUBSCRIBED') {
          fetchStats()
          setRefreshKey(k => k + 1)
        }
      })

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(settingsChannel)
    }
  }, [])

  if (isRestoringSession) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={{ alignItems: 'center', gap: 16 }}>
          <View style={styles.loginLogoRing}>
            <Text style={styles.loginLogoIcon}>🏨</Text>
          </View>
          <ActivityIndicator size="large" color={COLORS.gold} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' }}>
            Restoring session…
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!activeStaffUser) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={styles.loginContainer}>
          {/* Logo / Brand area */}
          <View style={styles.loginBrand}>
            <View style={styles.loginLogoRing}>
              <Text style={styles.loginLogoIcon}>🏨</Text>
            </View>
            <Text style={styles.loginBrandName}>Staff Portal</Text>
            <Text style={styles.loginBrandSub}>Authorized access only</Text>
          </View>

          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>Sign In</Text>

            <Text style={styles.inputLabel}>Email address</Text>
            <TextInput
              style={styles.input}
              value={loginEmail}
              onChangeText={setLoginEmail}
              placeholder="Enter your email"
              placeholderTextColor="#334155"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />

            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="Enter your password"
              placeholderTextColor="#334155"
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.loginButton, isLoggingIn && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={isLoggingIn}
            >
              <Text style={styles.loginButtonText}>
                {isLoggingIn ? 'Signing in…' : 'Sign In'}
              </Text>
            </TouchableOpacity>

            {!!loginError && <Text style={styles.loginError}>⚠ {loginError}</Text>}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* 📞 Incoming Live Call Overlay — Busy Guard: suppressed while staff is on active call */}
      {!activeCallRoom && incomingCallQueue.length > 0 && (
        <IncomingLiveCallAlert
          roomNumber={incomingCallQueue[0].roomNumber}
          channel={incomingCallQueue[0].channel}
          requestId={incomingCallQueue[0].requestId}
          queueCount={incomingCallQueue.length}
          onAnswer={handleAnswerLiveCall}
          onDecline={handleDeclineLiveCall}
        />
      )}

      {/* 🎤 Active Agora Voice Call Floating Bar */}
      {staffVoiceCall.isConnected && (
        <ActiveCallBar
          roomNumber={activeCallRoom || 'Guest'}
          callDurationSeconds={staffVoiceCall.callDurationSeconds}
          isMuted={staffVoiceCall.isMuted}
          isSpeakerOn={staffVoiceCall.isSpeakerOn}
          queuedCallsCount={incomingCallQueue.length}
          onToggleMute={staffVoiceCall.toggleMute}
          onToggleSpeaker={staffVoiceCall.toggleSpeaker}
          onEndCall={handleEndStaffCall}
        />
      )}

      {/* 📡 FCM Push & Background Diagnostics Modal */}
      <PushDiagnosticsModal
        visible={showDiagnosticsModal}
        onClose={() => setShowDiagnosticsModal(false)}
        activeStaffUser={activeStaffUser}
        pushToken={pushToken}
        pushLogs={pushLogs}
        onTriggerTestAlarm={handleTriggerTestAlarm}
        onCheckBattery={checkAndPromptBatteryOptimization}
      />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerIcon}>{activeStaffUser?.role === 'KITCHEN' ? '🍳' : '🏨'}</Text>
            <View style={styles.headerMeta}>
              <Text style={styles.headerTitle}>
                {activeStaffUser?.role === 'KITCHEN' ? 'F&B Kitchen' : 'Front Desk'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {activeStaffUser?.role === 'KITCHEN' ? 'Kitchen & Room Service Portal' : 'Tablet Interface'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {activeStaffUser?.role === 'KITCHEN' && (
                <TouchableOpacity
                  onPress={handleCallFnb}
                  style={[styles.syncButton, !fnbPhoneNumber && styles.syncButtonDisabled]}
                  activeOpacity={0.8}
                  disabled={!fnbPhoneNumber}
                >
                  <Text style={styles.syncButtonText}>
                    {fnbPhoneNumber ? '📞 Call F&B' : '📞 No F&B Number'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleManualSync}
                style={[styles.syncButton, isManualSyncing && styles.syncButtonActive]}
                activeOpacity={0.8}
                disabled={isManualSyncing}
              >
                <Text style={styles.syncButtonText}>
                  {isManualSyncing ? '⟳ Syncing…' : '⚡ Sync'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} activeOpacity={0.9}>
                <Text style={styles.logoutButtonText}>↩ Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Content */}
        {status === 'connecting' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.gold} />
            <Text style={styles.loadingText}>Connecting to Supabase...</Text>
          </View>
        )}

        {status === 'connected' && hotelInfo && (
          <Animated.View
            style={[
              styles.content,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Hotel Card */}
            <View style={styles.hotelCard}>
              <View style={styles.hotelCardHeader}>
                <Text style={styles.hotelCardLabel}>
                  {activeStaffUser?.role === 'KITCHEN' ? 'F&B Station' : 'Active Property'}
                </Text>
                <View style={styles.activePill}>
                  <Text style={styles.activePillText}>LIVE</Text>
                </View>
              </View>
              <Text style={styles.hotelName}>{hotelInfo.name}</Text>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Stats */}
              <View style={styles.statsRow}>
                {activeStaffUser?.role === 'KITCHEN' ? (
                  <>
                    <StatCard icon="🍽️" label="Pending Orders" value={String(pendingFood)} />
                    <View style={styles.statsDivider} />
                    <StatCard icon="📋" label="Orders Today" value={String(totalRequests)} />
                    <View style={styles.statsDivider} />
                    <StatCard icon="✅" label="Resolved Today" value={String(resolvedToday)} />
                  </>
                ) : (
                  <>
                    <StatCard icon="🚪" label="Rooms" value={String(roomCount)} />
                    <View style={styles.statsDivider} />
                    <StatCard icon="📋" label="Requests Today" value={String(totalRequests)} />
                    <View style={styles.statsDivider} />
                    <StatCard icon="✅" label="Resolved Today" value={String(resolvedToday)} />
                  </>
                )}
              </View>
            </View>

            {/* Module Cards */}
            <Text style={styles.sectionTitle}>Modules</Text>
            <View style={styles.moduleGrid}>
              {(activeStaffUser?.role === 'KITCHEN' ? [
                { icon: '🍽️', label: 'Food Orders', badge: String(pendingFood), color: '#34d399' },
              ] : [
                { icon: '📞', label: 'Call Queue',   badge: String(pendingCalls), color: COLORS.gold },
                { icon: '💆', label: 'Spa Bookings', badge: String(pendingSpa),   color: '#a78bfa' },
                { icon: '🍽️', label: 'Food Orders',  badge: String(pendingFood),  color: '#34d399' },
                { icon: '🛎️', label: 'Room Tasks',   badge: String(pendingTasks), color: '#60a5fa' },
              ]).map((mod) => (
                <TouchableOpacity
                  key={mod.label}
                  style={styles.moduleCard}
                  activeOpacity={0.7}
                >
                  <View style={[styles.moduleIconBg, { backgroundColor: `${mod.color}15` }]}>
                    <Text style={styles.moduleIcon}>{mod.icon}</Text>
                  </View>
                  <Text style={styles.moduleLabel}>{mod.label}</Text>
                  <View style={[styles.moduleBadge, { backgroundColor: `${mod.color}20` }]}>
                    <Text style={[styles.moduleBadgeText, { color: mod.color }]}>
                      {mod.badge}
                    </Text>
                  </View>
                  <Text style={styles.moduleArrow}>→</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Non-Kitchen modules restricted for KITCHEN role */}
            {activeStaffUser?.role !== 'KITCHEN' && (
              <>
                {/* 1. Dedicated Call Requests Module & Real-time Call Queue */}
                <DedicatedCallModule
                  activeStaffId={activeStaffUser?.id || undefined}
                  refreshTrigger={refreshKey}
                  onAnswerLiveCall={handleAnswerLiveCall}
                />
                <CallQueue
                  activeStaffId={activeStaffUser?.id}
                  refreshTrigger={refreshKey}
                  onAnswerLiveCall={handleAnswerLiveCall}
                />

                {/* 2. Spa Timetable & Appointments Queue */}
                <SpaTimetable activeStaffUser={activeStaffUser} activeStaffId={activeStaffUser?.id} />
                <SpaQueue activeStaffId={activeStaffUser?.id} activeStaffUser={activeStaffUser} refreshTrigger={refreshKey} />

                {/* 3. Room Task Queue */}
                <TaskQueue activeStaffId={activeStaffUser?.id} refreshTrigger={refreshKey} />
              </>
            )}

            {/* 4. Function Room Booking & Schedule Module */}
            <FunctionRoomModule activeStaffUser={activeStaffUser} />

            {/* 5. Food Orders Queue (Always visible to Kitchen, Admin, Front Desk) */}
            <FoodQueue activeStaffId={activeStaffUser?.id} activeStaffUser={activeStaffUser} refreshTrigger={refreshKey} />

            {/* 6. All Request History Logs */}
            <RequestHistory refreshTrigger={refreshKey} />

          </Animated.View>
        )}

        {status === 'error' && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Connection Failed</Text>
            <Text style={styles.errorMessage}>
              Could not connect to Supabase. Please check your{' '}
              <Text style={styles.errorHighlight}>.env</Text> credentials and try again.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchData}>
              <Text style={styles.retryText}>Retry Connection</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 📡 FCM Diagnostics FAB — floating bottom-right, never overlaps content */}
      <TouchableOpacity
        onPress={() => setShowDiagnosticsModal(true)}
        style={styles.fcmFab}
        activeOpacity={0.85}
      >
        <Text style={styles.fcmFabIcon}>📡</Text>
        <Text style={styles.fcmFabText}>
          {pushToken && !pushToken.startsWith('web_pwa_') && !pushToken.startsWith('expo_local_') ? 'FCM ✓' : 'FCM'}
        </Text>
      </TouchableOpacity>


      {/* 🚨 Incoming Request Aggressive Alert Modal */}
      <IncomingRequestAlert
        request={incomingAlert}
        onDismiss={() => setIncomingAlert(null)}
        enableSound={notificationSettings?.enable_sound_alert !== false}
        maxDurationSeconds={notificationSettings?.max_alert_duration_seconds || 30}
      />

      {/* ⏰ Dynamic Recurring Reminder Popup for Unhandled Requests */}
      <PendingRequestsReminderModal
        pendingRequests={unhandledPendingList}
        onDismiss={() => {
          lastDismissedReminderAtRef.current = Date.now()
          setUnhandledPendingList(null)
        }}
      />

      {/* 📡 Push Diagnostics & Logs Modal */}
      <PushDiagnosticsModal
        visible={showDiagnosticsModal}
        onClose={() => setShowDiagnosticsModal(false)}
        activeStaffUser={activeStaffUser}
        pushToken={pushToken}
        pushLogs={pushLogs}
        onTriggerTestAlarm={() => {
          triggerAlarmNotification({
            title: '🔔 Test Alarm Triggered',
            body: 'Manual test alarm executed successfully from diagnostics.',
            requestId: 'test-' + Date.now(),
            roomNumber: 'Test Room',
            requestType: 'TEST',
          })
        }}
        onCheckBattery={() => {
          checkAndPromptBatteryOptimization().catch(() => {})
        }}
      />

    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
    flexGrow: 1,
  },

  // Login screen
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 20,
  },
  loginBrand: {
    alignItems: 'center',
    gap: 10,
  },
  loginLogoRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.goldMuted,
    borderWidth: 1.5,
    borderColor: 'rgba(251,191,36,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  loginLogoIcon: {
    fontSize: 38,
  },
  loginBrandName: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  loginBrandSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  loginCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
    gap: 0,
  },
  loginTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 7,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: '#070e1c',
    color: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
  },
  loginButton: {
    marginTop: 22,
    backgroundColor: COLORS.gold,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.gold,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  loginButtonDisabled: {
    opacity: 0.65,
  },
  loginButtonText: {
    color: '#0c1117',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  loginError: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.08)',
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  // Header
  header: {
    marginBottom: 24,
    gap: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerMeta: {
    flex: 1,
  },
  headerIcon: {
    fontSize: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#7f1d1d',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  logoutButtonText: {
    color: '#fff1f2',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  syncButton: {
    backgroundColor: 'rgba(251,191,36,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonActive: {
    backgroundColor: 'rgba(251,191,36,0.28)',
    borderColor: COLORS.gold,
  },
  syncButtonDisabled: {
    opacity: 0.45,
    borderColor: 'rgba(148, 163, 184, 0.4)',
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  syncButtonText: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  diagButton: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagButtonText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // FCM Floating Action Button
  fcmFab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.45)',
    borderRadius: 50,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  fcmFabIcon: {
    fontSize: 15,
  },
  fcmFabText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 15,
  },

  // Content — no flex:1 inside ScrollView; let children define their own height
  content: {
    width: '100%',
  },

  // Hotel Card
  hotelCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 24,
  },
  hotelCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  hotelCardLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  activePill: {
    backgroundColor: COLORS.greenMuted,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  activePillText: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hotelName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statCard: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  statIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.gold,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statsDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    alignSelf: 'stretch',
  },

  // Modules
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  moduleGrid: {
    gap: 10,
  },
  moduleCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  moduleIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moduleIcon: {
    fontSize: 22,
  },
  moduleLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  moduleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  moduleBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  moduleArrow: {
    fontSize: 16,
    color: COLORS.textMuted,
  },

  // Error
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 12,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  errorMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorHighlight: {
    color: COLORS.gold,
    fontWeight: '600',
  },
  retryButton: {
    marginTop: 12,
    backgroundColor: COLORS.goldMuted,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
  },
  retryText: {
    color: COLORS.gold,
    fontSize: 15,
    fontWeight: '600',
  },

  // ─── PWA Banners ──────────────────────────────────────────
  pwaInstallBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
    gap: 10,
  },
  pwaInstallIcon: {
    fontSize: 22,
  },
  pwaInstallTitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
  },
  pwaInstallSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  pwaInstallBtn: {
    backgroundColor: '#38bdf8',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  pwaInstallBtnText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
  },

  pwaNotifBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.gold,
    gap: 10,
  },
  pwaNotifTitle: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '800',
  },
  pwaNotifBtn: {
    backgroundColor: COLORS.gold,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  pwaNotifBtnText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
  },
})
