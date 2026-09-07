'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import PhoneCaptureModal, { getStoredGuestPhone } from './PhoneCaptureModal'
import MicPermissionModal from './MicPermissionModal'
import OngoingCallNoticeModal from './OngoingCallNoticeModal'
import { checkActiveHotelCall, cancelLiveCallRequest } from '@/lib/callQueueService'
import { useGuestTheme } from './GuestThemeProvider'
import { useGuestVoiceCall } from './GuestVoiceCallEngine'

const AGORA_APP_ID =
  process.env.NEXT_PUBLIC_AGORA_APP_ID ||
  'c2e5d50d9273492d874b2a898f458334'


interface CallFrontDeskModalProps {
  isOpen: boolean
  onClose: () => void
  roomId: string
  hotelId: string
  hotelPhone?: string | null
  roomNumber: string
}

export default function CallFrontDeskModal({
  isOpen,
  onClose,
  roomId,
  hotelId,
  hotelPhone = '+18005550100',
  roomNumber,
}: CallFrontDeskModalProps) {
  const theme = useGuestTheme()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [status, setStatus] = useState<'IDLE' | 'PENDING' | 'CLAIMED' | 'FAILED' | 'VOICE_JOINING' | 'VOICE_LIVE' | 'VOICE_ENDED'>('IDLE')
  const [countdown, setCountdown] = useState(180) // 3 minutes
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [showMicModal, setShowMicModal] = useState(false)
  const [showOngoingCallModal, setShowOngoingCallModal] = useState(false)
  const [agoraError, setAgoraError] = useState<string | null>(null)

  // Agora voice call state
  const [agoraChannel, setAgoraChannel] = useState<string>('')
  const [agoraToken, setAgoraToken] = useState<string | null>(null)

  // Admin-controlled Live Voice Call visibility (notification_settings.enable_guest_live_call)
  const [liveCallEnabled, setLiveCallEnabled] = useState<boolean>(true)
  const isInitiatingRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return

    const fetchLiveCallSetting = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('notification_settings')
          .select('enable_guest_live_call')
          .eq('hotel_id', hotelId)
          .maybeSingle()

        if (data && typeof data.enable_guest_live_call === 'boolean') {
          setLiveCallEnabled(data.enable_guest_live_call)
        }
      } catch (err) {
        console.error('Failed to fetch guest live call setting:', err)
      }
    }

    fetchLiveCallSetting()
  }, [isOpen, hotelId])

  const handleStaffLeft = useCallback(() => {
    console.log('[CallFrontDeskModal] Staff left call, terminating guest session')
    setStatus('VOICE_ENDED')
  }, [])

  const handleConnectionFailure = useCallback((reason: string) => {
    console.warn('[CallFrontDeskModal] Agora connection failure:', reason)
    setAgoraError(reason)
  }, [])

  const isVoiceActive = status === 'VOICE_LIVE'
  const voiceCall = useGuestVoiceCall({
    appId: isVoiceActive ? AGORA_APP_ID : '',
    channel: isVoiceActive ? agoraChannel : '',
    token: isVoiceActive ? agoraToken : null,
    onStaffLeft: handleStaffLeft,
    onConnectionFailure: handleConnectionFailure,
  })

  // Countdown timer effect for PENDING state
  useEffect(() => {
    let timer: NodeJS.Timeout
    if (status === 'PENDING' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1)
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [status, countdown])

  // Supabase Realtime Subscription — watch for CLAIMED, LIVE, or RESOLVED
  useEffect(() => {
    if (!requestId) return

    const channel = supabase
      .channel(`request_${requestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'requests',
          filter: `id=eq.${requestId}`,
        },
        (payload: { new: { status: string } }) => {
          if (payload.new?.status === 'CLAIMED') {
            setStatus('CLAIMED')
          }
          if (payload.new?.status === 'LIVE') {
            setStatus('VOICE_LIVE')
          }
          if (payload.new?.status === 'RESOLVED' || payload.new?.status === 'DECLINED' || payload.new?.status === 'CANCELLED') {
            setStatus('VOICE_ENDED')
            voiceCall.endCall()
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [requestId, voiceCall])

  // Cleanup beacon/cancellation if guest closes browser tab mid-call
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (requestId && (status === 'VOICE_LIVE' || status === 'VOICE_JOINING')) {
        cancelLiveCallRequest(requestId)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [requestId, status])

  const executeRequestCall = async (phoneOverride?: string) => {
    setIsSubmitting(true)
    const phone = phoneOverride || getStoredGuestPhone()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('requests') as any)
        .insert([
          {
            hotel_id: hotelId,
            room_id: roomId,
            request_type: 'CALL_REQUEST',
            status: 'PENDING',
            payload: { room_number: roomNumber, note: 'Guest requested a callback', guest_phone: phone },
          },
        ])
        .select('id')
        .single()

      if (data) {
        const reqId = (data as { id: string }).id
        setRequestId(reqId)
        setStatus('PENDING')

        // ── Fire Web Push to all active staff PWA devices ──
        try {
          fetch('/api/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hotelId: hotelId || '00000000-0000-0000-0000-000000000001',
              title: `📞 Front Desk Call Request — Room ${roomNumber || '—'}`,
              body: phone ? `Guest requested an urgent callback [Phone: ${phone}]` : 'Guest requested a front desk callback.',
              requestId: reqId,
              roomNumber: roomNumber,
              requestType: 'CALL_REQUEST',
              url: '/',
            }),
          }).catch(() => {})
        } catch {
          // Push dispatch is non-blocking
        }
      }
    } catch (err) {
      console.error('Failed to submit call request:', err)
      setStatus('FAILED')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRequestCall = () => {
    const phone = getStoredGuestPhone()
    if (!phone) {
      setShowPhoneModal(true)
    } else {
      executeRequestCall(phone)
    }
  }

  // ── Pre-flight checks before joining voice call ─────────────────────────
  const startLiveCallSession = useCallback(async () => {
    if (isInitiatingRef.current) return
    isInitiatingRef.current = true
    setStatus('VOICE_JOINING')
    setAgoraError(null)

    try {
      // 1. Check if front desk line is already occupied by another caller
      const queueState = await checkActiveHotelCall(hotelId, roomId)
      if (queueState.hasActiveCall) {
        console.log('[CallFrontDeskModal] Front desk line is currently busy:', queueState)
        setShowOngoingCallModal(true)
        setStatus('IDLE')
        isInitiatingRef.current = false
        return
      }

      // 2. Get Agora token from server
      const channelName = `room-${roomId}-${Date.now()}`
      const res = await fetch(`/api/agora/token?channel=${channelName}&uid=1`)
      const { token } = await res.json()

      setAgoraChannel(channelName)
      setAgoraToken(token ?? null)

      // 3. Insert LIVE_CALL request in Supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('requests') as any)
        .insert([{
          hotel_id: hotelId,
          room_id: roomId,
          request_type: 'LIVE_CALL',
          status: 'PENDING',
          agora_channel: channelName,
          payload: { room_number: roomNumber, note: 'Guest initiated a live voice call' },
        }])
        .select('id')
        .single()

      if (error || !data?.id) throw error ?? new Error('Failed to create call request')

      setRequestId(data.id)
      setStatus('VOICE_LIVE') // Guest joins Agora immediately; staff answers when ready

      // 4. Fire FCM push to staff
      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelId || '00000000-0000-0000-0000-000000000001',
          title: `📞 Live Voice Call — Room ${roomNumber}`,
          body: 'Guest is calling. Tap to answer.',
          requestId: data.id,
          roomNumber,
          requestType: 'LIVE_CALL',
          agoraChannel: channelName,
          url: '/',
        }),
      }).catch(() => {})
    } catch (err) {
      console.error('[LiveVoiceCall] Setup error:', err)
      setStatus('IDLE')
    } finally {
      isInitiatingRef.current = false
    }
  }, [hotelId, roomId, roomNumber])

  // Click handler for Live Voice Call button
  const handleLiveVoiceCall = useCallback(async () => {
    if (!liveCallEnabled) return

    // Pre-flight check: microphone permission
    try {
      if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
            if (perm.state === 'denied') {
              setShowMicModal(true)
              return
            }
            if (perm.state === 'prompt') {
              setShowMicModal(true)
              return
            }
          } catch {
            // Some browsers reject query for microphone, fallback to direct check below
          }
        }

        // Quick test to confirm mic access is active
        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        testStream.getTracks().forEach((track) => track.stop())
      } else {
        setShowMicModal(true)
        return
      }
    } catch {
      // Permission prompt was blocked or dismissed
      setShowMicModal(true)
      return
    }

    // Permission granted, start call session
    startLiveCallSession()
  }, [liveCallEnabled, startLiveCallSession])

  const handleEndLiveCall = useCallback(async () => {
    await voiceCall.endCall()
    if (requestId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('requests') as any)
        .update({
          status: 'RESOLVED',
          call_ended_at: new Date().toISOString(),
        })
        .eq('id', requestId)
    }
    setStatus('VOICE_ENDED')
  }, [voiceCall, requestId])

  const formatSeconds = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
        <div className="glass-strong rounded-3xl p-8 max-w-sm w-full relative overflow-hidden animate-fade-up">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white text-base w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors font-bold"
          >
            ✕
          </button>

          {/* Modal Header */}
          <div className="text-center mb-8">
            <div
              className="w-24 h-24 rounded-3xl mx-auto mb-5 flex items-center justify-center text-5xl pulse-gold shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${theme.badgeBg} 0%, rgba(0,0,0,0.4) 100%)`,
                border: `1px solid ${theme.badgeBorder}`,
              }}
            >
              📞
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-1">Front Desk</h2>
            <p className="text-slate-400 text-sm font-medium">Room {roomNumber} · We&apos;re here to help</p>
          </div>

          {/* ── State: IDLE ─────────────────────────────────────── */}
          {status === 'IDLE' && (
            <div className="space-y-3">
              {/* Primary CTA — Direct dial */}
              <a
                href={`tel:${hotelPhone}`}
                className="w-full flex flex-col items-center justify-center gap-1 py-5 px-5 rounded-2xl font-extrabold text-base transition-all duration-200 hover:-translate-y-0.5 active:scale-95 shadow-xl min-h-[72px]"
                style={{
                  background: theme.gradient,
                  color: 'var(--gw-bg)',
                  boxShadow: `0 8px 24px -4px ${theme.glowRgba}`,
                }}
              >
                <span className="text-2xl">📱</span>
                <span>Call Front Desk Directly</span>
                <span className="text-[11px] opacity-70 font-medium">{hotelPhone}</span>
              </a>

              {/* Live Voice Call CTA (hidden when admin disables enable_guest_live_call) */}
              {liveCallEnabled && (
                <button
                  onClick={handleLiveVoiceCall}
                  disabled={isSubmitting}
                  className="w-full flex flex-col items-center justify-center gap-1 py-5 px-5 rounded-2xl font-bold text-base transition-all duration-200 active:scale-95 disabled:opacity-50 min-h-[72px]"
                  style={{
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(139,92,246,0.15) 100%)',
                    border: '1px solid rgba(99,102,241,0.4)',
                    color: '#a5b4fc',
                  }}
                >
                  <span className="text-2xl">🎤</span>
                  <span>Live Voice Call</span>
                  <span className="text-[11px] opacity-60 font-medium">Talk directly with staff</span>
                </button>
              )}

              {/* Secondary CTA — Staff callback request */}
              <button
                onClick={handleRequestCall}
                disabled={isSubmitting}
                className="w-full flex flex-col items-center justify-center gap-1 py-5 px-5 rounded-2xl font-bold text-base text-slate-100 transition-all duration-200 hover:bg-white/10 active:scale-95 disabled:opacity-50 min-h-[72px]"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.14)',
                }}
              >
                <span className="text-2xl">🛎️</span>
                <span>{isSubmitting ? 'Sending request…' : 'Request Staff Callback'}</span>
                <span className="text-[11px] opacity-60 font-medium">We&apos;ll call your room</span>
              </button>
            </div>
          )}

          {/* ── State: VOICE_JOINING ─────────────────────────────── */}
          {status === 'VOICE_JOINING' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-5xl animate-pulse">🎤</div>
              <p className="text-white font-bold text-lg">Setting up call…</p>
              <p className="text-slate-400 text-sm">Connecting to voice server</p>
            </div>
          )}

          {/* ── State: VOICE_LIVE ────────────────────────────────── */}
          {status === 'VOICE_LIVE' && (
            <div className="text-center py-4 space-y-5">
              <div
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${
                  voiceCall.remoteUserJoined
                    ? 'text-green-400 bg-green-400/10 border border-green-400/25'
                    : 'text-amber-400 bg-amber-400/10 border border-amber-400/25'
                }`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      voiceCall.remoteUserJoined ? 'bg-green-400' : 'bg-amber-400'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      voiceCall.remoteUserJoined ? 'bg-green-400' : 'bg-amber-400'
                    }`}
                  />
                </span>
                {voiceCall.remoteUserJoined
                  ? `Connected · ${formatSeconds(voiceCall.callDurationSeconds)}`
                  : 'Calling Front Desk…'}
              </div>

              <div className="text-6xl">
                {voiceCall.isMuted ? '🔇' : '🎤'}
              </div>

              <p className="text-slate-300 text-sm font-medium">
                {voiceCall.remoteUserJoined
                  ? "You're speaking with Front Desk"
                  : 'Front desk staff alerted. Ringing…'}
              </p>

              {agoraError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {agoraError}
                </div>
              )}

              <div className="flex gap-3 justify-center">
                {/* Mute toggle */}
                <button
                  onClick={voiceCall.toggleMute}
                  className="flex flex-col items-center gap-1 px-6 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95"
                  style={{
                    background: voiceCall.isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${voiceCall.isMuted ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.15)'}`,
                    color: voiceCall.isMuted ? '#f87171' : '#cbd5e1',
                  }}
                >
                  <span className="text-xl">{voiceCall.isMuted ? '🔇' : '🎤'}</span>
                  <span>{voiceCall.isMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                {/* End call */}
                <button
                  onClick={handleEndLiveCall}
                  className="flex flex-col items-center gap-1 px-6 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95"
                  style={{
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    color: '#f87171',
                  }}
                >
                  <span className="text-xl">📵</span>
                  <span>End Call</span>
                </button>
              </div>
            </div>
          )}

          {/* ── State: VOICE_ENDED ───────────────────────────────── */}
          {status === 'VOICE_ENDED' && (
            <div className="text-center py-6 space-y-4 animate-fade-in">
              <div className="text-5xl">📵</div>
              <p className="text-white font-bold text-lg">Call Ended</p>
              <p className="text-slate-400 text-xs">Thank you for contacting Front Desk.</p>
              <button
                onClick={onClose}
                className="w-full py-4 rounded-2xl font-bold text-slate-200 bg-white/8 hover:bg-white/15 transition-all active:scale-95 min-h-[56px]"
              >
                Close
              </button>
            </div>
          )}

          {/* ── State: PENDING (callback) ────────────────────────── */}
          {status === 'PENDING' && (
            <div className="text-center py-6 space-y-5">
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-sm font-bold text-amber-400 bg-amber-400/10 border border-amber-400/25">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                </span>
                Notifying Front Desk…
              </div>

              <div className="text-5xl font-mono font-extrabold text-white tracking-widest">
                {formatSeconds(countdown)}
              </div>

              <p className="text-slate-300 text-sm leading-relaxed max-w-xs mx-auto">
                Our front desk team has been alerted. A staff member will call your room shortly.
              </p>
            </div>
          )}

          {/* ── State: CLAIMED ───────────────────────────────────── */}
          {status === 'CLAIMED' && (
            <div className="text-center py-6 space-y-5 animate-fade-in">
              <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center text-4xl bg-green-500/20 border-2 border-green-500/50 text-green-400 shadow-xl">
                ✓
              </div>

              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold text-green-400 bg-green-400/10 border border-green-400/25">
                ✅ Staff Responded
              </div>

              <h3 className="text-xl font-extrabold text-white">Staff Member is Calling!</h3>

              <p className="text-slate-300 text-sm leading-relaxed max-w-xs mx-auto">
                A front desk team member has been assigned and is calling your room now.
              </p>

              <button
                onClick={onClose}
                className="mt-2 w-full py-4 rounded-2xl font-bold text-base text-slate-200 bg-white/8 hover:bg-white/15 transition-all active:scale-95 min-h-[56px]"
              >
                Close
              </button>
            </div>
          )}

          {/* ── State: FAILED ────────────────────────────────────── */}
          {status === 'FAILED' && (
            <div className="text-center py-6 space-y-4">
              <div className="text-4xl">⚠️</div>
              <p className="text-red-400 text-sm font-semibold">
                Could not send notification. Please call us directly.
              </p>
              <a
                href={`tel:${hotelPhone}`}
                className="flex flex-col items-center gap-1 w-full py-5 rounded-2xl font-extrabold text-base text-slate-900 bg-amber-400 hover:bg-amber-500 transition-all active:scale-95 shadow-xl min-h-[72px]"
              >
                <span className="text-2xl">📱</span>
                <span>Call Front Desk Directly</span>
              </a>
            </div>
          )}
        </div>
      </div>

      <PhoneCaptureModal
        isOpen={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onSuccess={(phone) => {
          setShowPhoneModal(false)
          executeRequestCall(phone)
        }}
        roomId={roomId}
        hotelId={hotelId}
      />

      <MicPermissionModal
        isOpen={showMicModal}
        onClose={() => setShowMicModal(false)}
        onGranted={() => {
          setShowMicModal(false)
          startLiveCallSession()
        }}
      />

      <OngoingCallNoticeModal
        isOpen={showOngoingCallModal}
        onClose={() => setShowOngoingCallModal(false)}
        onLineFree={() => {
          setShowOngoingCallModal(false)
          startLiveCallSession()
        }}
        onRequestCallback={() => {
          setShowOngoingCallModal(false)
          handleRequestCall()
        }}
        hotelId={hotelId}
        currentRoomId={roomId}
        roomNumber={roomNumber}
      />
    </>
  )
}
