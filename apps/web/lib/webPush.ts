import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BDZiJJ2o83qDdtVUQaVEEekgX3KVABFYZZzCRM76dtNgyEp3Sxe4TT9cBmcNcDTQ9RUIcQUjD0tu9pCoWkH4Xkg'
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Sd_eLFno7SUy-ViectiaP-0GAowqSXv8H9CoQcR9w5k'
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:gegatojohn93@gmail.com'

// Configure web-push with VAPID details
try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
} catch (e) {
  console.warn('[WebPush] Failed to set VAPID details:', e)
}

export interface WebPushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  url?: string
  requestId?: string
  roomNumber?: string
  requestType?: string
  [key: string]: any
}

export interface PushDispatchResult {
  sent: number
  failed: number
  expoDevicesReached: number
  webSubscribersReached: number
  expoReceipts?: any[]
  errors?: string[]
  targetUserFound?: {
    id: string
    name: string
    token: string | null
    tokenType: 'EXPO_FCM' | 'LOCAL_FALLBACK' | 'WEB_PWA' | 'MISSING'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Push Suppression Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a staff member is actively viewing the given conversation.
 * Returns true if presence is found AND is not stale (< 90 seconds old).
 * All errors are swallowed — on any failure, returns false (send normally).
 */
async function isStaffActiveInConversation(
  supabase: any,
  staffUserId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const staleThreshold = new Date(Date.now() - 90_000).toISOString()
    const { data } = await supabase
      .from('staff_presence')
      .select('id')
      .eq('staff_user_id', staffUserId)
      .eq('active_conversation_id', conversationId)
      .eq('is_active_in_conversation', true)
      .gt('last_seen_at', staleThreshold)
      .maybeSingle()
    return Boolean(data?.id)
  } catch {
    // Table may not exist yet (pre-migration); send normally
    return false
  }
}

/**
 * Check if the conversation is within the push cooldown window.
 * Only applies to GUEST_CHAT type — CHAT_HANDOFF always bypasses.
 * Returns true if still within cooldown (suppress), false if safe to send.
 */
async function isWithinCooldown(
  supabase: any,
  conversationId: string,
  cooldownSeconds: number
): Promise<boolean> {
  if (cooldownSeconds <= 0 || !conversationId) return false
  try {
    const { data } = await supabase
      .from('guest_conversations')
      .select('last_push_sent_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (!data?.last_push_sent_at) return false
    const lastSent = new Date(data.last_push_sent_at).getTime()
    return Date.now() - lastSent < cooldownSeconds * 1000
  } catch {
    return false
  }
}

/**
 * Determine if the current Manila time falls within the quiet hours window.
 * Handles overnight ranges (e.g., 22 → 7).
 */
function isInQuietHours(
  fromHour: number,
  toHour: number,
  staffFromOverride?: number | null,
  staffToOverride?: number | null
): boolean {
  try {
    const effectiveFrom = staffFromOverride ?? fromHour
    const effectiveTo = staffToOverride ?? toHour

    const manilaHour = parseInt(
      new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hour12: false,
      }),
      10
    )
    if (isNaN(manilaHour)) return false

    // Overnight range: e.g. 22 → 7 means 22, 23, 0, 1, 2, 3, 4, 5, 6
    if (effectiveFrom > effectiveTo) {
      return manilaHour >= effectiveFrom || manilaHour < effectiveTo
    }
    // Same-day range: e.g. 9 → 17
    return manilaHour >= effectiveFrom && manilaHour < effectiveTo
  } catch {
    return false
  }
}

/**
 * Update last_push_sent_at on the conversation after a successful batch send.
 * Fire-and-forget — never throws.
 */
async function recordPushSent(
  supabase: any,
  conversationId?: string
): Promise<void> {
  if (!conversationId) return
  try {
    await supabase
      .from('guest_conversations')
      .update({ last_push_sent_at: new Date().toISOString() })
      .eq('id', conversationId)
  } catch {
    // Non-fatal; column may not exist yet pre-migration
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Push Dispatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a high-priority push notification (both Web Push & Expo / FCM) to active staff devices for a hotel.
 * Works across:
 *  - Android Staff APK (via Expo / FCM High Priority push with wake lock & alarm channel)
 *  - Browser PWA (via WebPush VAPID)
 *
 * Push Suppression (Migration 29):
 *  - Staff with mute_guest_chat_push=true are always skipped for chat events
 *  - Staff actively viewing the exact conversation are suppressed (90s staleness guard)
 *  - GUEST_CHAT pushes respect push_cooldown_seconds; CHAT_HANDOFF always bypasses cooldown
 *  - Hotel-wide or per-staff quiet hours suppress all dispatches during the window
 */
export async function sendWebPushToHotelStaff(
  hotelId: string,
  payload: WebPushPayload,
  options?: { staffUserId?: string }
): Promise<PushDispatchResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bsjnlawhdgfilcfejbji.supabase.co'
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const defaultHotelId = '00000000-0000-0000-0000-000000000001'
  const targetHotelId = hotelId || defaultHotelId

  let sent = 0
  let failed = 0
  let expoDevicesReached = 0
  let webSubscribersReached = 0
  const expoReceipts: any[] = []
  const errors: string[] = []
  let targetUserFound: PushDispatchResult['targetUserFound'] = undefined

  const notificationTitle = payload.title || `🚨 New ${payload.requestType ? payload.requestType.replace(/_/g, ' ') : 'Guest Request'}`
  const notificationBody = payload.body || (payload.roomNumber ? `Room ${payload.roomNumber} submitted a new request.` : 'A guest request requires staff attention.')

  const rType = String(payload.requestType || '').toUpperCase()
  const isChatType = rType === 'GUEST_CHAT' || rType === 'CHAT_HANDOFF'
  const isEscalation = rType === 'CHAT_HANDOFF'
  const conversationId: string | undefined = payload.conversationId || (payload as any)?.convId

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. DISPATCH TO EXPO / FCM MOBILE DEVICES (Android Staff App)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    // 1a. Load hotel notification settings
    let notifSettings: any = null
    try {
      const { data: nData } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('hotel_id', targetHotelId)
        .maybeSingle()
      if (nData) notifSettings = nData
    } catch {
      // ignore
    }

    // Resolved hotel-level suppression settings (with safe defaults for pre-migration rows)
    const suppressIfActive: boolean = notifSettings?.suppress_if_active ?? true
    const cooldownSeconds: number = notifSettings?.push_cooldown_seconds ?? 30
    const quietHoursEnabled: boolean = notifSettings?.quiet_hours_enabled ?? false
    const quietHoursFrom: number = notifSettings?.quiet_hours_from ?? 22
    const quietHoursTo: number = notifSettings?.quiet_hours_to ?? 7

    // 1b. Hotel-level quiet hours gate (applies to all staff for all chat types)
    if (isChatType && quietHoursEnabled && !payload.isTestPush) {
      if (isInQuietHours(quietHoursFrom, quietHoursTo)) {
        console.log(`[Push] Quiet hours active (hotel-wide). Suppressing ${rType} push.`)
        return { sent: 0, failed: 0, expoDevicesReached: 0, webSubscribersReached: 0, errors: ['Suppressed: hotel quiet hours active'] }
      }
    }

    // 1c. GUEST_CHAT cooldown check (CHAT_HANDOFF escalations always bypass)
    if (isChatType && !isEscalation && !payload.isTestPush && conversationId) {
      const withinCooldown = await isWithinCooldown(supabase, conversationId, cooldownSeconds)
      if (withinCooldown) {
        console.log(`[Push] Cooldown active for conversation ${conversationId}. Suppressing GUEST_CHAT push.`)
        return { sent: 0, failed: 0, expoDevicesReached: 0, webSubscribersReached: 0, errors: [`Suppressed: within ${cooldownSeconds}s cooldown`] }
      }
    }

    let staffQuery = supabase
      .from('staff_users')
      .select('id, full_name, email, role, push_token, is_active, hotel_id, mute_guest_chat_push, suppress_push_when_active, quiet_hours_from_override, quiet_hours_to_override')

    if (options?.staffUserId) {
      staffQuery = staffQuery.eq('id', options.staffUserId)
    } else {
      staffQuery = staffQuery.eq('is_active', true)
      if (targetHotelId !== defaultHotelId) {
        staffQuery = staffQuery.or(`hotel_id.eq.${targetHotelId},hotel_id.eq.${defaultHotelId},hotel_id.is.null`)
      }
    }

    const { data: rawStaffData, error: staffErr } = await staffQuery

    if (staffErr) {
      errors.push(`Staff query error: ${staffErr.message}`)
    }

    // 1d. Role-Based Staff Filtering
    let staffData = rawStaffData || []
    if (staffData.length > 0 && payload.requestType && !payload.isTestPush && !options?.staffUserId) {
      staffData = staffData.filter((u) => {
        const uRole = String(u.role || '').toUpperCase()
        // Admins and Managers receive all notifications
        if (uRole === 'ADMIN' || uRole === 'MANAGER') return true

        // Custom notification settings check
        if (notifSettings) {
          if ((uRole === 'KITCHEN' || uRole === 'FNB') && Array.isArray(notifSettings.fnb_allowed_types)) {
            return notifSettings.fnb_allowed_types.includes(rType)
          }
          if ((uRole === 'FRONT_DESK' || uRole === 'HOUSEKEEPING' || uRole === 'MAINTENANCE') && Array.isArray(notifSettings.frontdesk_allowed_types)) {
            return (
              rType === 'CHAT_HANDOFF' ||
              rType === 'GUEST_CHAT' ||
              notifSettings.frontdesk_allowed_types.includes(rType) ||
              (rType === 'LIVE_CALL' && notifSettings.frontdesk_allowed_types.includes('CALL_REQUEST'))
            )
          }
          if (uRole === 'SPA' && Array.isArray(notifSettings.spa_allowed_types)) {
            return notifSettings.spa_allowed_types.includes(rType)
          }
        }

        // Default routing rules
        switch (uRole) {
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
      })
    }

    // 1e. Per-staff suppression filtering (chat types only, skip for test pushes)
    if (staffData.length > 0 && isChatType && !payload.isTestPush && !options?.staffUserId) {
      const suppressionChecks = await Promise.all(
        staffData.map(async (u) => {
          // Per-staff mute: completely skip this staff member for all chat events
          if (u.mute_guest_chat_push === true) {
            console.log(`[Push] Suppressed for ${u.full_name}: mute_guest_chat_push=true`)
            return { userId: u.id, suppress: true, reason: 'muted' }
          }

          // Per-staff personal quiet hours override
          if (u.quiet_hours_from_override != null && u.quiet_hours_to_override != null) {
            if (isInQuietHours(quietHoursFrom, quietHoursTo, u.quiet_hours_from_override, u.quiet_hours_to_override)) {
              console.log(`[Push] Suppressed for ${u.full_name}: personal quiet hours active`)
              return { userId: u.id, suppress: true, reason: 'personal_quiet_hours' }
            }
          }

          // Presence-based suppression: skip if actively viewing this exact conversation
          const effectiveSuppressIfActive = suppressIfActive && (u.suppress_push_when_active !== false)
          if (effectiveSuppressIfActive && conversationId) {
            const isActive = await isStaffActiveInConversation(supabase, u.id, conversationId)
            if (isActive) {
              console.log(`[Push] Suppressed for ${u.full_name}: actively viewing conversation ${conversationId}`)
              return { userId: u.id, suppress: true, reason: 'active_in_conversation' }
            }
          }

          return { userId: u.id, suppress: false, reason: null }
        })
      )

      const suppressedIds = new Set(
        suppressionChecks.filter((c) => c.suppress).map((c) => c.userId)
      )
      staffData = staffData.filter((u) => !suppressedIds.has(u.id))
    }

    if (!staffErr && staffData && staffData.length > 0) {
      if (options?.staffUserId && staffData[0]) {
        const u = staffData[0]
        const rawToken = u.push_token as string | null
        let tType: 'EXPO_FCM' | 'LOCAL_FALLBACK' | 'WEB_PWA' | 'MISSING' = 'MISSING'

        if (!rawToken) {
          tType = 'MISSING'
        } else if (
          rawToken.startsWith('ExponentPushToken[') ||
          rawToken.startsWith('ExpoPushToken[') ||
          (rawToken.length > 25 &&
            !rawToken.startsWith('expo_local_') &&
            !rawToken.startsWith('web_pwa_') &&
            !rawToken.startsWith('notifee_'))
        ) {
          tType = 'EXPO_FCM'
        } else if (rawToken.startsWith('expo_local_') || rawToken.startsWith('notifee_')) {
          tType = 'LOCAL_FALLBACK'
        } else if (rawToken.startsWith('web_pwa_')) {
          tType = 'WEB_PWA'
        }

        targetUserFound = {
          id: u.id,
          name: u.full_name,
          token: rawToken,
          tokenType: tType,
        }

        if (tType === 'LOCAL_FALLBACK') {
          errors.push(
            `Target device registered a local fallback token ("${rawToken?.slice(0, 28)}..."). Remote push delivery requires a live ExponentPushToken[...] or native FCM token. Local alarms can be tested using the "🔔 Trigger Local Test Alarm" button in the staff app header.`
          )
        } else if (tType === 'MISSING') {
          errors.push('Target staff account has no push token stored in the database.')
        }
      }

      const expoTokens = staffData
        .map((s) => s.push_token)
        .filter((token): token is string =>
          Boolean(
            token &&
              (token.startsWith('ExponentPushToken[') ||
                token.startsWith('ExpoPushToken[') ||
                (token.length > 25 &&
                  !token.startsWith('web_pwa_') &&
                  !token.startsWith('expo_local_') &&
                  !token.startsWith('notifee_')))
          )
        )

      expoDevicesReached = expoTokens.length

      if (expoTokens.length > 0) {
        console.log(`[Push] Dispatching Expo/FCM push to ${expoTokens.length} role-targeted staff device(s)...`)

        const expoMessages = expoTokens.map((token) => ({
          to: token,
          sound: 'alarm',
          title: notificationTitle,
          body: notificationBody,
          data: {
            title: notificationTitle,
            body: notificationBody,
            requestId: payload.requestId,
            conversationId: conversationId,
            roomNumber: payload.roomNumber,
            requestType: payload.requestType,
            agoraChannel: payload.agoraChannel || (payload as any)?.channel,
            url: payload.url || '/',
            isTestPush: payload.isTestPush || false,
            dispatchedAt: new Date().toISOString(),
          },
          priority: 'high',
          channelId: 'hotel_staff_alarm',
          categoryId: 'URGENT_REQUEST',
          ttl: 86400,
          _displayInForeground: true,
        }))

        // Chunk messages to Expo Push API
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(expoMessages),
        })

        if (response.ok) {
          const resJson = await response.json()
          const receipts = resJson.data || []
          receipts.forEach((r: any, idx: number) => {
            expoReceipts.push({
              token: expoTokens[idx],
              ...r,
            })
            if (r.status === 'ok') sent++
            else {
              failed++
              errors.push(`Expo ticket error: ${r.message || r.details?.error || 'Unknown error'}`)
            }
          })
          console.log(`[Push] Expo/FCM push result: ${sent} sent, ${failed} failed`)

          // Record successful dispatch timestamp on conversation (for cooldown tracking)
          if (sent > 0 && isChatType && conversationId) {
            await recordPushSent(supabase, conversationId)
          }
        } else {
          const errText = await response.text()
          errors.push(`Expo Push API HTTP ${response.status}: ${errText}`)
          failed += expoTokens.length
        }
      }
    }
  } catch (expoErr: any) {
    console.error('[Push] Error dispatching Expo/FCM push:', expoErr)
    errors.push(`Expo dispatch exception: ${expoErr?.message || expoErr}`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. DISPATCH TO WEB PWA SUBSCRIBERS (Browser WebPush)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    let subscriptionsQuery = supabase
      .from('staff_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('is_active', true)

    if (targetHotelId !== defaultHotelId) {
      subscriptionsQuery = subscriptionsQuery.or(`hotel_id.eq.${targetHotelId},hotel_id.eq.${defaultHotelId}`)
    }

    const { data: subscriptions, error } = await subscriptionsQuery

    if (!error && subscriptions && subscriptions.length > 0) {
      const notificationString = JSON.stringify({
        title: notificationTitle,
        body: notificationBody,
        icon: payload.icon || '/assets/icon.png',
        badge: payload.badge || '/favicon.png',
        tag: payload.tag || `hotel-req-${Date.now()}`,
        url: payload.url || '/',
        requestId: payload.requestId,
        roomNumber: payload.roomNumber,
        requestType: payload.requestType,
        timestamp: Date.now(),
      })

      const expiredIds: string[] = []

      await Promise.allSettled(
        subscriptions.map(async (sub) => {
          if (!sub.endpoint || !sub.p256dh || !sub.auth) return

          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          }

          try {
            await webpush.sendNotification(pushSubscription, notificationString, {
              urgency: 'high', // Wakes Android phone up from sleep / doze mode
              TTL: 60 * 60 * 24, // 24 hours
            })
            sent++
          } catch (err: any) {
            failed++
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              expiredIds.push(sub.id)
            } else {
              console.warn('[WebPush] Error sending push to endpoint:', err?.message || err)
            }
          }
        })
      )

      webSubscribersReached = subscriptions.length
      if (expiredIds.length > 0) {
        try {
          await supabase
            .from('staff_push_subscriptions')
            .update({ is_active: false })
            .in('id', expiredIds)
        } catch {
          // non-fatal cleanup
        }
      }
    }
  } catch (webErr: any) {
    console.error('[WebPush] Error sending WebPush:', webErr)
    errors.push(`WebPush dispatch exception: ${webErr?.message || webErr}`)
  }

  return { sent, failed, expoDevicesReached, webSubscribersReached, expoReceipts, errors, targetUserFound }
}
