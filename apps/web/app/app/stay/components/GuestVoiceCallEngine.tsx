'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface UseGuestVoiceCallOptions {
  appId: string
  channel: string
  token: string | null
  onStaffLeft?: () => void
  onConnectionFailure?: (reason: string) => void
}

export interface GuestVoiceCallState {
  isConnected: boolean
  isMuted: boolean
  remoteUserJoined: boolean
  callDurationSeconds: number
  error: string | null
  toggleMute: () => void
  endCall: () => Promise<void>
}

/**
 * Browser-side Agora RTC hook for guest voice calling.
 * Guest always joins as UID=1.
 * Dynamically imports agora-rtc-sdk-ng to avoid SSR issues in Next.js.
 */
export function useGuestVoiceCall({
  appId,
  channel,
  token,
  onStaffLeft,
  onConnectionFailure,
}: UseGuestVoiceCallOptions): GuestVoiceCallState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localTrackRef = useRef<any>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [remoteUserJoined, setRemoteUserJoined] = useState(false)
  const [callDurationSeconds, setCallDurationSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Keep callback refs stable
  const onStaffLeftRef = useRef(onStaffLeft)
  const onConnectionFailureRef = useRef(onConnectionFailure)
  useEffect(() => {
    onStaffLeftRef.current = onStaffLeft
    onConnectionFailureRef.current = onConnectionFailure
  }, [onStaffLeft, onConnectionFailure])

  // Track call duration when staff is joined
  useEffect(() => {
    let timer: NodeJS.Timeout
    if (isConnected && remoteUserJoined) {
      timer = setInterval(() => {
        setCallDurationSeconds((prev) => prev + 1)
      }, 1000)
    } else {
      setCallDurationSeconds(0)
    }
    return () => clearInterval(timer)
  }, [isConnected, remoteUserJoined])

  // Join channel on mount
  useEffect(() => {
    if (!appId || !channel) return

    let isMounted = true

    const join = async () => {
      try {
        setError(null)
        // Dynamic import — avoids SSR errors since Agora requires browser APIs
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
        AgoraRTC.setLogLevel(4) // Error-only logging in production

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        clientRef.current = client

        // Guest is always UID=1
        await client.join(appId, channel, token ?? null, 1)

        // Create and publish microphone track
        const micTrack = await AgoraRTC.createMicrophoneAudioTrack()
        localTrackRef.current = micTrack
        await client.publish([micTrack])

        // Connection state listener to detect dropouts/failures
        client.on('connection-state-change', (curState: string, _revState: string, reason?: string) => {
          if (!isMounted) return
          console.log('[GuestVoiceCall] connection-state-change:', curState, reason)
          if (curState === 'FAILED') {
            setError(reason || 'Call connection failed')
            onConnectionFailureRef.current?.(reason || 'Call connection failed')
          }
        })

        // Auto-play remote audio streams (staff speaking)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('user-published', async (user: any, mediaType: 'audio' | 'video') => {
          await client.subscribe(user, mediaType)
          if (mediaType === 'audio') {
            user.audioTrack?.play()
            if (isMounted) setRemoteUserJoined(true)
          }
        })

        // Remote user joins channel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('user-joined', (user: any) => {
          console.log('[GuestVoiceCall] Remote user joined:', user.uid)
          if (isMounted) setRemoteUserJoined(true)
        })

        // Remote user unpublished track
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('user-unpublished', (user: any, mediaType: string) => {
          if (mediaType === 'audio') {
            user.audioTrack?.stop()
          }
        })

        // Immediate cleanup when staff drops the call or disconnects
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('user-left', async (user: any, reason: string) => {
          console.log('[GuestVoiceCall] Remote user left channel:', user.uid, reason)
          if (!isMounted) return

          // Immediate local track teardown to prevent lingering mic usage
          try {
            if (localTrackRef.current) {
              localTrackRef.current.stop()
              localTrackRef.current.close()
              localTrackRef.current = null
            }
            await client.leave()
          } catch (teardownErr) {
            console.warn('[GuestVoiceCall] Teardown on user-left error:', teardownErr)
          } finally {
            if (isMounted) {
              setIsConnected(false)
              setRemoteUserJoined(false)
            }
            onStaffLeftRef.current?.()
          }
        })

        if (isMounted) setIsConnected(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error('[GuestVoiceCall] Join error:', err)
        if (isMounted) {
          const msg = err?.message ?? 'Failed to join voice call'
          setError(msg)
          onConnectionFailureRef.current?.(msg)
        }
      }
    }

    join()

    return () => {
      isMounted = false
    }
  }, [appId, channel, token])

  const endCall = useCallback(async () => {
    try {
      if (localTrackRef.current) {
        localTrackRef.current.stop()
        localTrackRef.current.close()
        localTrackRef.current = null
      }
      if (clientRef.current) {
        await clientRef.current.leave()
        clientRef.current = null
      }
    } catch (err) {
      console.warn('[GuestVoiceCall] Leave error:', err)
    } finally {
      setIsConnected(false)
      setRemoteUserJoined(false)
    }
  }, [])

  const toggleMute = useCallback(() => {
    const track = localTrackRef.current
    if (!track) return
    const next = !isMuted
    track.setEnabled(!next)
    setIsMuted(next)
  }, [isMuted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (localTrackRef.current) {
          localTrackRef.current.stop()
          localTrackRef.current.close()
          localTrackRef.current = null
        }
        clientRef.current?.leave().catch(() => {})
      } catch {
        // Safe unmount teardown
      }
    }
  }, [])

  return {
    isConnected,
    isMuted,
    remoteUserJoined,
    callDurationSeconds,
    error,
    toggleMute,
    endCall,
  }
}
