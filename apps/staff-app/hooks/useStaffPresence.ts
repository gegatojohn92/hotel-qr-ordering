import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const HOTEL_ID = '00000000-0000-0000-0000-000000000001'
const HEARTBEAT_INTERVAL_MS = 30_000  // 30 seconds — stays well within the 90s staleness guard
const STALE_THRESHOLD_MS    = 90_000  // Must match server-side check in webPush.ts

/**
 * useStaffPresence
 *
 * Upserts a `staff_presence` row on mount indicating the authenticated staff member
 * is actively viewing the given conversation. Sends a heartbeat every 30 seconds to
 * keep `last_seen_at` fresh. Clears the presence row on unmount (navigate away / close).
 *
 * The server-side `webPush.ts` queries this table before dispatching FCM pushes:
 * if a fresh (< 90 second old) presence record exists for a staff member in the
 * target conversation, the push is suppressed to avoid redundant notifications.
 *
 * @param staffUserId  - The authenticated staff user's UUID (from staff_users.id)
 * @param conversationId - The guest_conversations.id currently being viewed, or null
 */
export function useStaffPresence(
  staffUserId: string | null | undefined,
  conversationId: string | null | undefined
): void {
  // Use a ref to track the last conversationId so cleanup always uses the correct value
  const conversationIdRef = useRef<string | null>(conversationId ?? null)
  const staffUserIdRef    = useRef<string | null>(staffUserId ?? null)

  useEffect(() => {
    conversationIdRef.current = conversationId ?? null
    staffUserIdRef.current    = staffUserId ?? null
  })

  useEffect(() => {
    const uid  = staffUserId
    const cid  = conversationId

    // Skip if required values are missing
    if (!uid || !cid) return

    let isMounted = true

    // ── Upsert: mark staff as active in this conversation ────────────────────
    const upsertPresence = async () => {
      try {
        await (supabase as any)
          .from('staff_presence')
          .upsert(
            {
              staff_user_id:             uid,
              hotel_id:                  HOTEL_ID,
              is_active_in_conversation: true,
              active_conversation_id:    cid,
              last_seen_at:              new Date().toISOString(),
              updated_at:                new Date().toISOString(),
            },
            { onConflict: 'staff_user_id' }
          )
      } catch (err) {
        // Table may not exist yet pre-migration; silently ignore
        console.warn('[Presence] upsert failed (pre-migration?):', err)
      }
    }

    upsertPresence()

    // ── Heartbeat: refresh last_seen_at every 30s ─────────────────────────────
    const heartbeatTimer = setInterval(async () => {
      if (!isMounted) return
      try {
        await (supabase as any)
          .from('staff_presence')
          .update({
            last_seen_at: new Date().toISOString(),
          })
          .eq('staff_user_id', uid)
      } catch {
        // Non-fatal — next heartbeat will retry
      }
    }, HEARTBEAT_INTERVAL_MS)

    // ── Cleanup: clear presence when staff navigates away ────────────────────
    return () => {
      isMounted = false
      clearInterval(heartbeatTimer)

      // Fire-and-forget clear — use ref values in case they changed before unmount
      const finalUid = staffUserIdRef.current || uid
      ;(supabase as any)
        .from('staff_presence')
        .update({
          is_active_in_conversation: false,
          active_conversation_id:    null,
          updated_at:                new Date().toISOString(),
        })
        .eq('staff_user_id', finalUid)
        .then(() => {
          // Presence cleared
        })
        .catch(() => {
          // Non-fatal
        })
    }
  }, [staffUserId, conversationId])
}

export { STALE_THRESHOLD_MS, HEARTBEAT_INTERVAL_MS }
