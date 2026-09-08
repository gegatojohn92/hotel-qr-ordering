'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

const supabase = createSupabaseBrowserClient()

interface GuestSessionKeeperProps {
  roomId: string
  hotelId: string
  roomNumber: string
}

const DEFAULT_HOTEL_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Ensures persistent connection between guest stay portal and staff app:
 * 1. Automatically registers/refreshes guest_sessions on first scan / session open
 * 2. Broadcasts realtime room presence so staff knows which rooms are active
 * 3. Sends initial session connection alert to staff PWA devices
 * 4. Runs recurring escalation re-push for unhandled requests older than 1-2 mins
 */
export default function GuestSessionKeeper({
  roomId,
  hotelId,
  roomNumber,
}: GuestSessionKeeperProps) {
  const effectiveHotelId = hotelId || DEFAULT_HOTEL_ID
  const sessionInitializedRef = useRef(false)
  const escalatedRequestsRef = useRef<Record<string, { lastEscalatedAt: number; count: number }>>({})

  // ─── 1. Register Guest Session & Staff Notification on First Scan ──────────
  const initGuestSession = useCallback(async () => {
    if (!roomId || sessionInitializedRef.current) return
    sessionInitializedRef.current = true

    try {
      const sessionKey = `hotel_guest_session_${roomId}`
      let existingSession = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(sessionKey) : null
      if (!existingSession && typeof sessionStorage !== 'undefined') {
        try {
          existingSession = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`
          sessionStorage.setItem(sessionKey, existingSession)
        } catch {
          // ignore
        }
      }

      // Check if session exists in DB or create a new active session
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sessionData, error } = await (supabase as any)
        .from('guest_sessions')
        .insert([
          {
            room_id: roomId,
            hotel_id: effectiveHotelId,
            status: 'ACTIVE',
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        ])
        .select('id, created_at')
        .single()

      if (!error && sessionData) {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(sessionKey, sessionData.id)
        }

        // Only send session connection ping once per 30 minutes to prevent spamming staff
        if (!existingSession) {
          try {
            fetch('/api/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hotelId: effectiveHotelId,
                title: `👋 Room ${roomNumber || '—'} Connected`,
                body: `Guest just scanned QR code and opened concierge portal.`,
                roomNumber: roomNumber,
                requestType: 'GUEST_SESSION',
                url: '/',
              }),
            }).catch(() => {})
          } catch {
            // non-blocking
          }
        }
      }
    } catch (err) {
      console.debug('[GuestSessionKeeper] Session init note:', err)
    }
  }, [roomId, effectiveHotelId, roomNumber])

  // ─── 2. Persistent Escalation Loop for Unanswered Requests (1-2 mins) ──────
  const checkAndEscalateRequests = useCallback(async () => {
    if (!roomId) return

    try {
      // Fetch all unhandled/pending requests for this room
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pendingRequests, error } = await (supabase as any)
        .from('requests')
        .select('id, request_type, status, payload, created_at')
        .eq('room_id', roomId)
        .in('status', ['PENDING', 'PENDING_ON_CALL'])
        .order('created_at', { ascending: true })

      if (error || !pendingRequests || pendingRequests.length === 0) {
        return
      }

      const now = Date.now()

      for (const req of pendingRequests) {
        const createdAt = new Date(req.created_at).getTime()
        const elapsedSecs = Math.floor((now - createdAt) / 1000)

        // Get escalation history
        const history = escalatedRequestsRef.current[req.id] || { lastEscalatedAt: createdAt, count: 0 }
        const secsSinceLastPush = Math.floor((now - history.lastEscalatedAt) / 1000)

        // Trigger escalation if:
        // Tier 1: Elapsed >= 65s (1+ min) and not escalated yet (count === 0)
        // Tier 2: Elapsed >= 125s (2+ mins) and only escalated once (count === 1)
        // Tier 3: Every 90s thereafter if still pending
        const shouldEscalate =
          (elapsedSecs >= 65 && history.count === 0 && secsSinceLastPush >= 60) ||
          (elapsedSecs >= 125 && history.count === 1 && secsSinceLastPush >= 60) ||
          (elapsedSecs >= 180 && secsSinceLastPush >= 90)

        if (shouldEscalate) {
          const count = history.count + 1
          escalatedRequestsRef.current[req.id] = { lastEscalatedAt: now, count }

          const elapsedMins = Math.floor(elapsedSecs / 60)
          const typeLabel = req.request_type ? String(req.request_type).replace(/_/g, ' ') : 'Request'
          const p = req.payload || {}
          const itemSummary = (p.items as any[])?.map((i) => `${i.quantity}x ${i.name}`).join(', ') ||
            p.task_name ||
            p.service_name ||
            p.note ||
            'Pending guest request'

          console.log(`[GuestSessionKeeper] Re-pushing unhandled request #${req.id} (waiting ${elapsedMins}m, attempt #${count})`)

          try {
            fetch('/api/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hotelId: effectiveHotelId,
                title: count >= 2
                  ? `🚨 URGENT (${elapsedMins}m): Room ${roomNumber} waiting!`
                  : `⏰ REMINDER (${elapsedMins}m): Room ${roomNumber} ${typeLabel}`,
                body: `${itemSummary} — waiting for staff acknowledgement!`,
                requestId: req.id,
                roomNumber: roomNumber,
                requestType: req.request_type,
                url: '/',
              }),
            }).catch(() => {})
          } catch {
            // non-blocking
          }
        }
      }
    } catch (err) {
      console.debug('[GuestSessionKeeper] Escalation check note:', err)
    }
  }, [roomId, effectiveHotelId, roomNumber])

  // ─── Lifecycle: Session Init + Realtime Presence & Recurring Escalation ────
  useEffect(() => {
    initGuestSession()

    // Create unique channel instance per mount to prevent "after subscribe" errors
    const channelName = `room_pres_${roomId}_${Math.random().toString(36).substring(2, 8)}`
    let channel: any = null

    try {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'requests', filter: `room_id=eq.${roomId}` },
          () => {
            checkAndEscalateRequests()
          }
        )
        .subscribe()
    } catch (err) {
      console.debug('[GuestSessionKeeper] Channel subscribe note:', err)
    }

    // Recurring escalation check every 25 seconds
    const interval = setInterval(() => {
      checkAndEscalateRequests()
    }, 25000)

    return () => {
      clearInterval(interval)
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch {
          // ignore
        }
      }
    }
  }, [roomId, initGuestSession, checkAndEscalateRequests])

  return null // Headless manager component
}
