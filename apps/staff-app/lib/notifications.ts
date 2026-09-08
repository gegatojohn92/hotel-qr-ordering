/**
 * notifications.ts
 *
 * Hybrid aggressive notification system:
 *
 * PRIMARY (always works):
 *   expo-notifications → local notification channel with ALARM audio stream,
 *   bypasses Silent mode & DND. Works in foreground + recent background.
 *
 * ENHANCEMENT (when Notifee native module is linked):
 *   @notifee/react-native → Full-Screen Intent, WakeLock, looping sound,
 *   fires even when app is killed or screen is locked.
 *
 * WEB fallback: browser Notification API.
 */

import { Platform } from 'react-native'

// ─── Channel IDs ───────────────────────────────────────────────────────────────
export const ALARM_CHANNEL_ID      = 'hotel_staff_alarm'
export const ALARM_NOTIFICATION_ID = 'incoming_request_alarm'
/** Kept for backwards compatibility */
export const URGENT_CHANNEL_ID     = 'hotel_staff_alarm'

// ─── Safe dynamic import helpers ───────────────────────────────────────────────

/** Returns the expo-notifications module or null on web */
function getExpoNotifications() {
  if (Platform.OS === 'web') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-notifications')
  } catch {
    return null
  }
}

/** Returns Notifee default export or null when native module is not linked */
function getNotifee() {
  if (Platform.OS === 'web') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native')
    // Verify the native module is actually linked (not just the JS shim)
    const notifee = mod.default ?? mod
    if (!notifee || typeof notifee.displayNotification !== 'function') return null
    return notifee
  } catch {
    return null
  }
}

function getNotifeeEnums() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@notifee/react-native')
  } catch {
    return {}
  }
}

// ─── Channel Setup ─────────────────────────────────────────────────────────────

/**
 * Create the ALARM-priority notification channel on Android.
 * Uses expo-notifications (always available) + Notifee (if linked).
 * Must be called once at app startup — idempotent.
 */
export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS === 'web') return

  // ── Primary: expo-notifications ALARM channel ──
  const Notifications = getExpoNotifications()
  if (Notifications) {
    // Set foreground presentation handler
    try {
      if (typeof Notifications.setNotificationHandler === 'function') {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        })
      }
    } catch (e) {
      console.warn('[Notifications] setNotificationHandler:', e)
    }

    // Create ALARM-stream channel on Android
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
          name: '🚨 Hotel Staff Alarm',
          description: 'Critical alerts for incoming guest requests — bypasses Silent & DND',
          importance: Notifications.AndroidImportance?.MAX ?? 5,
          vibrationPattern: [0, 400, 100, 400, 100, 400, 100, 600],
          lightColor: '#EF4444',
          enableLights: true,
          enableVibrate: true,
          audioAttributes: {
            usage: Notifications.AndroidAudioUsage?.ALARM ?? 4,      // USAGE_ALARM → bypasses Silent + DND
            contentType: Notifications.AndroidAudioContentType?.SONIFICATION ?? 4,
            flags: { enforceAudibility: true, requestHardwareAudioVideoSynchronization: false },
          },
          bypassDnd: true,
          showBadge: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
        })
        console.log('[Notifications] ALARM channel created via expo-notifications ✅')
      } catch (err) {
        console.warn('[Notifications] expo-notifications channel setup failed:', err)
      }
    }
  }

  // ── Enhancement: Notifee ALARM channel (when native module is linked) ──
  const notifee = getNotifee()
  if (notifee && Platform.OS === 'android') {
    try {
      const { AndroidImportance, AndroidAudioUsage, AndroidAudioContentType } = getNotifeeEnums()
      await notifee.createChannel({
        id: ALARM_CHANNEL_ID,
        name: '🚨 Hotel Staff Alarm (Notifee)',
        importance: AndroidImportance?.HIGH ?? 4,
        sound: 'alarm',
        audioAttributes: {
          usage: AndroidAudioUsage?.ALARM ?? 4,
          contentType: AndroidAudioContentType?.SONIFICATION ?? 4,
        },
        vibration: true,
        vibrationPattern: [0, 400, 100, 400, 100, 400, 100, 600],
        lights: true,
        lightColor: '#EF4444',
        bypassDnd: true,
      })
      console.log('[Notifications] Notifee ALARM channel created ✅')
    } catch (err) {
      console.warn('[Notifications] Notifee channel setup failed (non-fatal):', err)
    }
  }
}

// ─── Permissions ───────────────────────────────────────────────────────────────

let lastTokenError: string | null = null

export function getLastPushTokenError(): string | null {
  return lastTokenError
}

/**
 * Request notification permissions on the current platform.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  lastTokenError = null

  // Web fallback
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission()
        if (perm === 'granted') return `web_pwa_${Date.now()}`
      } catch (err) {
        console.warn('[Notifications] Web permission error:', err)
      }
    }
    return null
  }

  // ── Primary: expo-notifications permission request ──
  const Notifications = getExpoNotifications()
  if (Notifications && typeof Notifications.getPermissionsAsync === 'function') {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      let finalStatus = existingStatus

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          android: {},
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowCriticalAlerts: true,
          },
        })
        finalStatus = status
      }

      if (finalStatus !== 'granted') {
        lastTokenError = 'Notification permission was denied by user in Android settings.'
        console.warn('[Notifications] Expo permission not granted')
        return null
      }

      console.log('[Notifications] expo-notifications permission granted ✅')

      // ── Strategy 1: getExpoPushTokenAsync() without projectId ──
      try {
        if (typeof Notifications.getExpoPushTokenAsync === 'function') {
          const tokenData = await Notifications.getExpoPushTokenAsync()
          if (tokenData?.data) {
            console.log('[Notifications] ✅ Obtained Real Expo Push Token (auto-config):', tokenData.data)
            return tokenData.data
          }
        }
      } catch (err1: any) {
        console.warn('[Notifications] Strategy 1 getExpoPushTokenAsync() without args failed:', err1?.message)
      }

      // ── Strategy 2: getExpoPushTokenAsync() with EAS Project ID ──
      try {
        if (typeof Notifications.getExpoPushTokenAsync === 'function') {
          let easProjectId: string | undefined
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Constants = require('expo-constants').default ?? require('expo-constants')
            easProjectId =
              Constants?.expoConfig?.extra?.eas?.projectId ??
              Constants?.easConfig?.projectId
          } catch {
            // ignore
          }

          const targetProjectId = easProjectId || 'c443e903-bcbf-4c9a-9167-bdc0f3195d1f'

          const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: targetProjectId,
          })
          if (tokenData?.data) {
            console.log('[Notifications] ✅ Obtained Real Expo Push Token (FCM):', tokenData.data)
            return tokenData.data
          }
        }
      } catch (tokenErr: any) {
        lastTokenError = tokenErr?.message || String(tokenErr)
        console.warn('[Notifications] getExpoPushTokenAsync failed (trying native device token):', tokenErr)
      }

      // ── Strategy 3: Native FCM Device Token ──
      try {
        if (typeof Notifications.getDevicePushTokenAsync === 'function') {
          const deviceToken = await Notifications.getDevicePushTokenAsync()
          if (deviceToken?.data) {
            console.log('[Notifications] ✅ Obtained Native Device FCM Token:', deviceToken.data)
            return deviceToken.data
          }
        }
      } catch (devErr: any) {
        lastTokenError = `${lastTokenError ? lastTokenError + ' | ' : ''}getDevicePushTokenAsync: ${devErr?.message || devErr}`
        console.warn('[Notifications] getDevicePushTokenAsync failed:', devErr)
      }

      return `expo_local_${Platform.OS}_${Date.now()}`
    } catch (err: any) {
      lastTokenError = err?.message || String(err)
      console.warn('[Notifications] expo-notifications permission request failed:', err)
    }
  }

  // ── Enhancement: Notifee permission (when linked) ──
  const notifee = getNotifee()
  if (notifee && typeof notifee.requestPermission === 'function') {
    try {
      const settings = await notifee.requestPermission({ alert: true, badge: true, sound: true })
      if (settings.authorizationStatus >= 1) {
        return `notifee_${Platform.OS}_${Date.now()}`
      }
    } catch (err) {
      console.warn('[Notifications] Notifee permission request failed (non-fatal):', err)
    }
  }

  return null
}

// ─── Token Lifecycle & Cleansing Helpers ─────────────────────────────────────

export interface NotificationSettings {
  id?: string
  hotel_id: string
  reminder_interval_minutes: number
  enable_sound_alert: boolean
  max_alert_duration_seconds: number
  fnb_allowed_types: string[]
  frontdesk_allowed_types: string[]
  spa_allowed_types: string[]
  enable_guest_live_call?: boolean
  created_at?: string
  updated_at?: string
}

/**
 * Role-Based Notification Permission Check:
 * Determines if a given staff role should receive alerts / push for a request type.
 */
export function canRoleReceiveNotification(
  userRole?: string | null,
  requestType?: string | null,
  settings?: NotificationSettings | {
    fnb_allowed_types?: string[]
    frontdesk_allowed_types?: string[]
    spa_allowed_types?: string[]
  } | null
): boolean {
  if (!userRole || !requestType) return true
  const role = String(userRole).toUpperCase()
  const rType = String(requestType).toUpperCase()

  // Admins and Managers receive all notifications
  if (role === 'ADMIN' || role === 'MANAGER') return true

  // If custom hotel notification_settings are available, check custom configured rules
  if (settings) {
    if ((role === 'KITCHEN' || role === 'FNB') && Array.isArray(settings.fnb_allowed_types) && settings.fnb_allowed_types.length > 0) {
      return settings.fnb_allowed_types.includes(rType)
    }
    if ((role === 'FRONT_DESK' || role === 'HOUSEKEEPING' || role === 'MAINTENANCE') && Array.isArray(settings.frontdesk_allowed_types) && settings.frontdesk_allowed_types.length > 0) {
      return settings.frontdesk_allowed_types.includes(rType) || (rType === 'LIVE_CALL' && settings.frontdesk_allowed_types.includes('CALL_REQUEST'))
    }
    if (role === 'SPA' && Array.isArray(settings.spa_allowed_types) && settings.spa_allowed_types.length > 0) {
      return settings.spa_allowed_types.includes(rType)
    }
  }

  // Default hardcoded routing rules
  switch (role) {
    case 'KITCHEN':
    case 'FNB':
      return rType === 'FOOD_ORDER'
    case 'SPA':
      return rType === 'SPA_BOOKING'
    case 'HOUSEKEEPING':
    case 'MAINTENANCE':
      return rType === 'TASK'
    case 'FRONT_DESK':
      return (
        rType === 'CALL_REQUEST' ||
        rType === 'LIVE_CALL' ||
        rType === 'TASK' ||
        rType === 'CHAT_HANDOFF' ||
        rType === 'GUEST_CHAT'
      )
    default:
      return true
  }
}

/**
 * Bind an active device push token to a staff user with strict 1:1 mapping.
 * 1. Unlinks the token from any other staff accounts that previously used this physical device/browser.
 * 2. Assigns the token to the newly logged-in userId.
 */
export async function bindPushTokenToStaffUser(
  supabaseClient: any,
  userId: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  if (!userId || !token) return { success: false, error: 'Missing userId or token' }
  try {
    // 1. Unbind token from any other accounts on this shared device
    await supabaseClient
      .from('staff_users')
      .update({ push_token: null })
      .eq('push_token', token)
      .neq('id', userId)

    // 2. Bind token to the current user
    const { error } = await supabaseClient
      .from('staff_users')
      .update({ push_token: token })
      .eq('id', userId)

    if (error) throw error
    console.log(`[Notifications] ✅ Push token successfully bound exclusively to staff user ${userId}`)
    return { success: true }
  } catch (err: any) {
    console.warn('[Notifications] bindPushTokenToStaffUser error:', err?.message || err)
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * Unbind and clean up push token from staff user upon logout.
 */
export async function clearPushTokenFromStaffUser(
  supabaseClient: any,
  userId: string
): Promise<void> {
  if (!userId) return
  try {
    await supabaseClient
      .from('staff_users')
      .update({ push_token: null })
      .eq('id', userId)
    console.log(`[Notifications] 🧹 Cleaned push_token to NULL for staff user ${userId} on logout`)
  } catch (err) {
    console.warn('[Notifications] clearPushTokenFromStaffUser caught:', err)
  }
}

// ─── Alarm Trigger ─────────────────────────────────────────────────────────────

/**
 * Fire an aggressive alarm notification.
 *
 * Strategy:
 *  1. Notifee (if linked) → Full-Screen Intent + WakeLock + looping alarm.
 *  2. expo-notifications → ALARM-stream heads-up notification (always works).
 *  3. Web → browser Notification API.
 */
export async function triggerAlarmNotification(params: {
  title: string
  body: string
  requestId: string
  roomNumber: string
  requestType: string
  payloadData?: Record<string, unknown>
}): Promise<void> {

  // ── Web ──
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const title = `🚨 ${params.title} — ${params.roomNumber}`
        const opts: NotificationOptions = {
          body: params.body,
          icon: '/assets/icon.png',
          tag: `request-${params.requestId}`,
          data: { requestId: params.requestId, roomNumber: params.roomNumber, requestType: params.requestType, ...params.payloadData },
          requireInteraction: true,
        }
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready
          await reg.showNotification(title, opts)
        } else {
          new Notification(title, opts)
        }
      } catch (err) {
        console.warn('[Notifications] Web notification error:', err)
      }
    }
    return
  }

  const notificationData = {
    requestId: params.requestId,
    roomNumber: params.roomNumber,
    requestType: params.requestType,
    ...(params.payloadData as Record<string, string> ?? {}),
  }

  // ── Enhancement: Notifee Full-Screen Intent (when native module is linked) ──
  const notifee = getNotifee()
  if (notifee) {
    try {
      const { AndroidImportance, AndroidCategory, AndroidVisibility } = getNotifeeEnums()
      await notifee.displayNotification({
        id: ALARM_NOTIFICATION_ID,
        title: `<b>🚨 ${params.title}</b>`,
        subtitle: params.roomNumber,
        body: params.body,
        data: notificationData,
        android: {
          channelId: ALARM_CHANNEL_ID,
          fullScreenAction: { id: 'default', launchActivity: 'default' },
          wakeLockTimeout: 60_000,
          sound: 'alarm',
          loopSound: true,
          importance: AndroidImportance?.HIGH ?? 4,
          category: AndroidCategory?.CALL ?? 'call',
          visibility: AndroidVisibility?.PUBLIC ?? 1,
          ongoing: false,
          autoCancel: false,
          vibrationPattern: [0, 400, 100, 400, 100, 400, 100, 600],
          lights: ['#EF4444', 500, 500] as any,
          actions: [{
            title: '✓ ACKNOWLEDGE',
            pressAction: { id: 'acknowledge', launchActivity: 'default' },
          }],
        },
      })
      console.log('[Notifications] Notifee Full-Screen Intent fired ✅')
      return // Notifee handled it — skip expo-notifications
    } catch (err) {
      console.warn('[Notifications] Notifee displayNotification failed, falling back to expo-notifications:', err)
    }
  }

  // ── Primary fallback: expo-notifications local notification ──
  const Notifications = getExpoNotifications()
  if (!Notifications || typeof Notifications.scheduleNotificationAsync !== 'function') return

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🚨 ${params.title} — ${params.roomNumber}`,
        body: params.body,
        priority: Notifications.AndroidNotificationPriority?.MAX ?? 2,
        vibrate: [0, 400, 100, 400, 100, 400, 100, 600],
        data: notificationData,
        // No 'sticky' here — expo-notifications handles it via channel
      },
      trigger: {
        channelId: ALARM_CHANNEL_ID,
      } as any,
    })
    console.log('[Notifications] expo-notifications alarm scheduled ✅')
  } catch (err) {
    console.warn('[Notifications] expo-notifications scheduleNotificationAsync failed:', err)
  }
}

/** @deprecated Alias for backwards compatibility */
export const triggerAggressiveAlert = triggerAlarmNotification

// ─── Cancellation ──────────────────────────────────────────────────────────────

/**
 * Cancel the alarm notification and stop looping sound.
 * Called when staff acknowledges a request.
 */
export async function cancelAlarmNotification(id = ALARM_NOTIFICATION_ID): Promise<void> {
  if (Platform.OS === 'web') return

  // Cancel via Notifee if linked
  const notifee = getNotifee()
  if (notifee) {
    try { await notifee.cancelNotification(id) } catch { /* ignore */ }
  }

  // Also dismiss via expo-notifications
  const Notifications = getExpoNotifications()
  if (Notifications && typeof Notifications.dismissAllNotificationsAsync === 'function') {
    try { await Notifications.dismissAllNotificationsAsync() } catch { /* ignore */ }
  }
}

/**
 * Cancel ALL alarm notifications. Call when staff acknowledges any request.
 */
export async function cancelAllAlarms(): Promise<void> {
  if (Platform.OS === 'web') return

  const notifee = getNotifee()
  if (notifee) {
    try { await notifee.cancelAllNotifications() } catch { /* ignore */ }
  }

  const Notifications = getExpoNotifications()
  if (Notifications) {
    try {
      if (typeof Notifications.dismissAllNotificationsAsync === 'function') {
        await Notifications.dismissAllNotificationsAsync()
      }
      if (typeof Notifications.setBadgeCountAsync === 'function') {
        await Notifications.setBadgeCountAsync(0)
      }
    } catch { /* ignore */ }
  }
}

// ─── Event Listeners ───────────────────────────────────────────────────────────

/**
 * Listen for notification tap responses (foreground).
 * Tries Notifee first, falls back to expo-notifications.
 * Returns an unsubscribe handle.
 */
export function addNotificationResponseListener(
  callback: (data: any) => void
): { remove: () => void } {
  if (Platform.OS === 'web') return { remove: () => {} }

  // ── Notifee foreground event (when linked) ──
  const notifee = getNotifee()
  if (notifee && typeof notifee.onForegroundEvent === 'function') {
    try {
      const { EventType } = getNotifeeEnums()
      const unsub = notifee.onForegroundEvent(({ type, detail }: any) => {
        const isPress = type === (EventType?.PRESS ?? 1) || type === (EventType?.ACTION_PRESS ?? 2)
        if (isPress && detail?.notification?.data) {
          callback(detail.notification.data)
        }
      })
      // Also attach expo-notifications listener for dismissal handling
      const Notifications = getExpoNotifications()
      let expoSub: any = null
      if (Notifications && typeof Notifications.addNotificationResponseReceivedListener === 'function') {
        expoSub = Notifications.addNotificationResponseReceivedListener((response: any) => {
          callback(response?.notification?.request?.content?.data)
        })
      }
      return {
        remove: () => {
          try { if (typeof unsub === 'function') unsub() } catch { /* ignore */ }
          try {
            if (expoSub) {
              if (typeof expoSub.remove === 'function') expoSub.remove()
              else if (Notifications && typeof Notifications.removeNotificationSubscription === 'function') {
                Notifications.removeNotificationSubscription(expoSub)
              }
            }
          } catch { /* ignore */ }
        },
      }
    } catch { /* fall through to expo-notifications */ }
  }

  // ── Primary fallback: expo-notifications response listener ──
  const Notifications = getExpoNotifications()
  if (!Notifications || typeof Notifications.addNotificationResponseReceivedListener !== 'function') {
    return { remove: () => {} }
  }

  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response?.notification?.request?.content?.data
      if (data) callback(data)
    })
    return {
      remove: () => {
        try {
          if (sub && typeof sub.remove === 'function') sub.remove()
          else if (typeof Notifications.removeNotificationSubscription === 'function') {
            Notifications.removeNotificationSubscription(sub)
          }
        } catch { /* ignore */ }
      },
    }
  } catch {
    return { remove: () => {} }
  }
}

/**
 * Listen for notifications received while app is foregrounded.
 */
export function addNotificationReceivedListener(
  callback: (notification: any) => void
): { remove: () => void } {
  if (Platform.OS === 'web') return { remove: () => {} }

  const Notifications = getExpoNotifications()
  if (!Notifications || typeof Notifications.addNotificationReceivedListener !== 'function') {
    return { remove: () => {} }
  }

  try {
    const sub = Notifications.addNotificationReceivedListener((notif: any) => {
      callback(notif)
    })
    return {
      remove: () => {
        try {
          if (sub && typeof sub.remove === 'function') sub.remove()
          else if (typeof Notifications.removeNotificationSubscription === 'function') {
            Notifications.removeNotificationSubscription(sub)
          }
        } catch { /* ignore */ }
      },
    }
  } catch {
    return { remove: () => {} }
  }
}

/**
 * Register the background event handler for when the app is killed/backgrounded.
 * Must be called at module level in index.ts before registerRootComponent.
 * Notifee-only — expo-notifications handles background via system tray tap.
 */
export function registerBackgroundNotificationHandler(): void {
  if (Platform.OS === 'web') return

  const notifee = getNotifee()
  if (!notifee || typeof notifee.onBackgroundEvent !== 'function') return

  try {
    const { EventType } = getNotifeeEnums()
    notifee.onBackgroundEvent(async ({ type, detail }: any) => {
      const isAck =
        type === (EventType?.ACTION_PRESS ?? 2) &&
        detail?.pressAction?.id === 'acknowledge'
      if (isAck) {
        await cancelAllAlarms()
      }
    })
    console.log('[Notifications] Notifee background handler registered ✅')
  } catch (err) {
    console.warn('[Notifications] registerBackgroundNotificationHandler (non-fatal):', err)
  }
}
