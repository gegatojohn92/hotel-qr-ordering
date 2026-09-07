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
 * Native Android & iOS implementation of Agora voice calling for staff-app.
 * Uses `react-native-agora` + `react-native-incall-manager`.
 * Staff always joins as UID=2.
 */
export function useStaffVoiceCall({ onCallEnded }: UseStaffVoiceCallOptions = {}): StaffVoiceCallState {
  const engineRef = useRef<any>(null)

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

  const cleanupEngine = useCallback(async () => {
    try {
      const InCallManagerMod = await import('react-native-incall-manager')
      const InCallManager = InCallManagerMod.default ?? InCallManagerMod
      if (InCallManager && typeof InCallManager.stop === 'function') {
        InCallManager.stop()
      }
    } catch (err) {
      console.warn('[StaffVoiceCall:Native] InCallManager stop error:', err)
    }

    if (engineRef.current) {
      const engine = engineRef.current
      engineRef.current = null
      try {
        if (typeof engine.unregisterEventHandler === 'function') {
          engine.unregisterEventHandler()
        }
        if (typeof engine.leaveChannel === 'function') {
          engine.leaveChannel()
        }
        if (typeof engine.release === 'function') {
          engine.release()
        } else if (typeof engine.destroy === 'function') {
          engine.destroy()
        }
      } catch (err) {
        console.warn('[StaffVoiceCall:Native] Engine cleanup error:', err)
      }
    }

    setIsConnected(false)
    setIsMuted(false)
    setIsSpeakerOn(true)
  }, [])

  const joinChannel = useCallback(
    async (channel: string, token: string | null, appId: string) => {
      try {
        // Pre-flight cleanup: Ensure any previous lingering connection/engine is cleanly closed
        await cleanupEngine()

        const agoraMod = await import('react-native-agora')
        const InCallManagerMod = await import('react-native-incall-manager')
        const InCallManager = InCallManagerMod.default ?? InCallManagerMod

        const createEngine = (agoraMod as any).default || (agoraMod as any).createAgoraRtcEngine
        const engine = typeof createEngine === 'function' ? createEngine() : null
        if (!engine) throw new Error('Could not create Agora RTC engine')

        engineRef.current = engine

        if (typeof engine.initialize === 'function') {
          engine.initialize({ appId })
        }

        if (typeof engine.enableAudio === 'function') {
          engine.enableAudio()
        }
        if (typeof engine.disableVideo === 'function') {
          engine.disableVideo()
        }
        if (typeof engine.setEnableSpeakerphone === 'function') {
          engine.setEnableSpeakerphone(true)
        }

        if (typeof engine.registerEventHandler === 'function') {
          engine.registerEventHandler({
            onJoinChannelSuccess: (_connection: any, _elapsed: number) => {
              console.log('[StaffVoiceCall:Native] Successfully joined channel')
              setIsConnected(true)
            },
            onError: async (err: any, _msg: any) => {
              console.error('[StaffVoiceCall:Native] Engine error:', err, _msg)
              await cleanupEngine()
              onCallEnded?.()
            },
            onUserJoined: (_connection: any, uid: number) => {
              console.log('[StaffVoiceCall:Native] Remote user joined:', uid)
              setIsConnected(true)
            },
            onUserOffline: async (_connection: any, uid: number) => {
              console.log('[StaffVoiceCall:Native] Remote user left:', uid)
              await cleanupEngine()
              onCallEnded?.()
            },
          })
        } else if (typeof engine.addListener === 'function') {
          engine.addListener('JoinChannelSuccess', () => {
            console.log('[StaffVoiceCall:Native] Successfully joined channel')
            setIsConnected(true)
          })
          engine.addListener('UserJoined', (uid: number) => {
            console.log('[StaffVoiceCall:Native] Remote user joined:', uid)
            setIsConnected(true)
          })
          engine.addListener('UserOffline', async (uid: number) => {
            console.log('[StaffVoiceCall:Native] Remote user left:', uid)
            await cleanupEngine()
            onCallEnded?.()
          })
        }

        if (typeof engine.setChannelProfile === 'function') {
          engine.setChannelProfile((agoraMod as any).ChannelProfileType?.ChannelProfileCommunication ?? 0)
        }
        if (typeof engine.setClientRole === 'function') {
          engine.setClientRole((agoraMod as any).ClientRoleType?.ClientRoleBroadcaster ?? 1)
        }

        // Staff always joins as UID=2. react-native-agora v4 signature:
        // joinChannel(token, channelId, uid, options)
        if (typeof engine.joinChannel === 'function') {
          const joinResult = engine.joinChannel(token ?? '', channel, 2, {
            clientRoleType: (agoraMod as any).ClientRoleType?.ClientRoleBroadcaster ?? 1,
            channelProfile: (agoraMod as any).ChannelProfileType?.ChannelProfileCommunication ?? 0,
            publishMicrophoneTrack: true,
            publishCameraTrack: false,
            autoSubscribeAudio: true,
            autoSubscribeVideo: false,
          })
          if (typeof joinResult === 'number' && joinResult < 0) {
            throw new Error(`Agora joinChannel failed with code ${joinResult}`)
          }
        }

        // Start in-call audio mode (proximity sensor, speaker routing)
        if (InCallManager && typeof InCallManager.start === 'function') {
          InCallManager.start({ media: 'audio', auto: true, ringback: '' })
          if (typeof InCallManager.setForceSpeakerphoneOn === 'function') {
            InCallManager.setForceSpeakerphoneOn(true)
          }
        }

        setIsConnected(true)
        setIsMuted(false)
        setIsSpeakerOn(true)
      } catch (err) {
        console.error('[StaffVoiceCall:Native] Join error:', err)
        await cleanupEngine()
        throw err
      }
    },
    [cleanupEngine, onCallEnded]
  )

  const leaveChannel = useCallback(async () => {
    try {
      await cleanupEngine()
    } finally {
      onCallEnded?.()
    }
  }, [cleanupEngine, onCallEnded])

  const toggleMute = useCallback(async () => {
    const next = !isMuted
    if (engineRef.current && typeof engineRef.current.muteLocalAudioStream === 'function') {
      await engineRef.current.muteLocalAudioStream(next)
    }
    setIsMuted(next)
  }, [isMuted])

  const toggleSpeaker = useCallback(async () => {
    const next = !isSpeakerOn
    if (engineRef.current && typeof engineRef.current.setEnableSpeakerphone === 'function') {
      await engineRef.current.setEnableSpeakerphone(next)
    }
    setIsSpeakerOn(next)
  }, [isSpeakerOn])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      cleanupEngine()
    }
  }, [cleanupEngine])

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
