import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native'

interface IncomingLiveCallAlertProps {
  roomNumber: string
  channel: string
  requestId: string
  queueCount?: number
  onAnswer: (channel: string, requestId: string) => void
  onDecline: (requestId: string) => void
}

const AUTO_DISMISS_SECONDS = 45

export default function IncomingLiveCallAlert({
  roomNumber,
  channel,
  requestId,
  queueCount = 1,
  onAnswer,
  onDecline,
}: IncomingLiveCallAlertProps) {
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS)
  const pulseAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(-Dimensions.get('window').height)).current

  // Slide in from top
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start()
  }, [slideAnim])

  // Pulsing ring animation
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulseAnim])

  // Auto-decline countdown
  useEffect(() => {
    if (countdown <= 0) {
      onDecline(requestId)
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, requestId, onDecline])

  return (
    <Animated.View style={[styles.overlay, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerLabel}>INCOMING LIVE CALL</Text>
            {queueCount > 1 && (
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>1 of {queueCount} Waiting</Text>
              </View>
            )}
          </View>
          <Text style={styles.countdown}>{countdown}s</Text>
        </View>

        {/* Phone icon (pulsing) */}
        <Animated.View style={[styles.iconWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.icon}>📞</Text>
        </Animated.View>

        {/* Room info */}
        <Text style={styles.roomTitle}>Room {roomNumber}</Text>
        <Text style={styles.subtitle}>Guest is calling via Live Voice</Text>

        {/* Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.declineButton]}
            onPress={() => onDecline(requestId)}
            activeOpacity={0.8}
          >
            <Text style={styles.declineIcon}>📵</Text>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.answerButton]}
            onPress={() => onAnswer(channel, requestId)}
            activeOpacity={0.8}
          >
            <Text style={styles.answerIcon}>📞</Text>
            <Text style={styles.answerText}>Answer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.4)',
    padding: 28,
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  queueBadge: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  queueBadgeText: {
    color: '#0f172a',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countdown: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  iconWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(99,102,241,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 40,
  },
  roomTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 4,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 28,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  declineButton: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  declineIcon: { fontSize: 22 },
  declineText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 14,
  },
  answerButton: {
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  answerIcon: { fontSize: 22 },
  answerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
})
