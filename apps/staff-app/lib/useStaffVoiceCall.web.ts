import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseStaffVoiceCallOptions {
  onCallEnded?: () => void
}

export interface StaffVoiceCallState {
  isConnected: boolean
  isMuted: boolean
  isSpeakerOn: boolean
  callDurationSeconds: number
  joinChannel: (channel: string, token: string | null, appId: string) => Promise<void>
  leaveChannel: () => Promise<void>
  toggleMute: () => void
  toggleSpeaker: () => void
}

/**
 * Web Browser implementation of Agora voice calling for staff-app.
 * Uses `agora-rtc-sdk-ng` for direct WebRTC browser audio streaming.
 * Staff joins as UID=2.
 */
export function useStaffVoiceCall({ onCallEnded }: UseStaffVoiceCallOptions = {}): StaffVoiceCallState {
  const clientRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeakerOn, setIsSpeakerOn] = useState(true)
  const [callDurationSeconds, setCallDurationSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => {
        setCallDurationSeconds((s) => s + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setCallDurationSeconds(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isConnected])

  const joinChannel = useCallback(
    async (channel: string, token: string | null, appId: string) => {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
        AgoraRTC.setLogLevel(4)

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        clientRef.current = client

        // Staff always joins as UID=2
        await client.join(appId, channel, token ?? null, 2)

        // Capture microphone
        const micTrack = await AgoraRTC.createMicrophoneAudioTrack()
        localTrackRef.current = micTrack
        await client.publish([micTrack])

        // Auto-play incoming audio from guest (UID 1)
        client.on('user-published', async (user: any, mediaType: 'audio' | 'video') => {
          await client.subscribe(user, mediaType)
          if (mediaType === 'audio') {
            user.audioTrack?.play()
          }
        })

        client.on('user-unpublished', (user: any, mediaType: 'audio' | 'video') => {
          if (mediaType === 'audio') {
            user.audioTrack?.stop()
          }
        })

        client.on('user-left', () => {
          console.log('[StaffVoiceCall:Web] Guest left call')
          setIsConnected(false)
          onCallEnded?.()
        })

        setIsConnected(true)
        setIsMuted(false)
        setIsSpeakerOn(true)
      } catch (err) {
        console.error('[StaffVoiceCall:Web] Join error:', err)
        throw err
      }
    },
    [onCallEnded]
  )

  const leaveChannel = useCallback(async () => {
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
      console.warn('[StaffVoiceCall:Web] Leave error:', err)
    } finally {
      setIsConnected(false)
      onCallEnded?.()
    }
  }, [onCallEnded])

  const toggleMute = useCallback(() => {
    const next = !isMuted
    const track = localTrackRef.current
    if (track) {
      track.setEnabled(!next)
    }
    setIsMuted(next)
  }, [isMuted])

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((s) => !s)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      localTrackRef.current?.stop()
      localTrackRef.current?.close()
      clientRef.current?.leave().catch(() => {})
    }
  }, [])

  return {
    isConnected,
    isMuted,
    isSpeakerOn,
    callDurationSeconds,
    joinChannel,
    leaveChannel,
    toggleMute,
    toggleSpeaker,
  }
}
