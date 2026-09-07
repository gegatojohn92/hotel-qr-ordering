import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native'

interface ActiveCallBarProps {
  roomNumber: string
  callDurationSeconds: number
  isMuted: boolean
  isSpeakerOn: boolean
  queuedCallsCount?: number
  onToggleMute: () => void
  onToggleSpeaker: () => void
  onEndCall: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function ActiveCallBar({
  roomNumber,
  callDurationSeconds,
  isMuted,
  isSpeakerOn,
  queuedCallsCount = 0,
  onToggleMute,
  onToggleSpeaker,
  onEndCall,
}: ActiveCallBarProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current

  // Subtle pulsing green dot to indicate live call
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulseAnim])

  return (
    <View style={styles.bar}>
      {/* Live indicator + room info */}
      <View style={styles.left}>
        <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
        <View>
          <Text style={styles.liveLabel}>LIVE CALL</Text>
          <Text style={styles.roomText}>Room {roomNumber}</Text>
        </View>
        {queuedCallsCount > 0 && (
          <View style={styles.queueBadge}>
            <Text style={styles.queueBadgeText}>+{queuedCallsCount} Waiting</Text>
          </View>
        )}
      </View>

      {/* Timer */}
      <Text style={styles.timer}>{formatDuration(callDurationSeconds)}</Text>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Mute */}
        <TouchableOpacity style={styles.controlBtn} onPress={onToggleMute} activeOpacity={0.7}>
          <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
        </TouchableOpacity>

        {/* Speaker */}
        <TouchableOpacity style={styles.controlBtn} onPress={onToggleSpeaker} activeOpacity={0.7}>
          <Text style={styles.controlIcon}>{isSpeakerOn ? '🔊' : '🔈'}</Text>
        </TouchableOpacity>

        {/* End Call */}
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={onEndCall} activeOpacity={0.7}>
          <Text style={styles.controlIcon}>📵</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0a3d2e',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    borderRadius: 12,
    marginTop: 8,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  liveLabel: {
    color: '#22c55e',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  roomText: {
    color: '#f0fdf4',
    fontSize: 13,
    fontWeight: '700',
  },
  queueBadge: {
    backgroundColor: '#f59e0b',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 6,
  },
  queueBadgeText: {
    color: '#0f172a',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  timer: {
    color: '#86efac',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginHorizontal: 12,
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: {
    fontSize: 16,
  },
  endBtn: {
    backgroundColor: 'rgba(239,68,68,0.25)',
  },
})
