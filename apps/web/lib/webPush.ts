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

/**
 * Dispatch a high-priority push notification (both Web Push & Expo / FCM) to active staff devices for a hotel.
 * Works across:
 *  - Android Staff APK (via Expo / FCM High Priority push with wake lock & alarm channel)
 *  - Browser PWA (via WebPush VAPID)
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. DISPATCH TO EXPO / FCM MOBILE DEVICES (Android Staff App)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    // 1a. Load hotel notification settings if available
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

    let staffQuery = supabase
      .from('staff_users')
      .select('id, full_name, email, role, push_token, is_active, hotel_id')

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

    // 1b. Role-Based Staff Filtering
    let staffData = rawStaffData || []
    if (staffData.length > 0 && payload.requestType && !payload.isTestPush && !options?.staffUserId) {
      const rType = String(payload.requestType).toUpperCase()
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
            return notifSettings.frontdesk_allowed_types.includes(rType) || (rType === 'LIVE_CALL' && notifSettings.frontdesk_allowed_types.includes('CALL_REQUEST'))
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
            requestId: payload.requestId,
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
