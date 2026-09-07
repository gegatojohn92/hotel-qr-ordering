'use client'

import { useEffect, useState, useRef } from 'react'
import { subscribeToCallQueue, HotelCallQueueState } from '@/lib/callQueueService'
import { useGuestTheme } from './GuestThemeProvider'

interface OngoingCallNoticeModalProps {
  isOpen: boolean
  onClose: () => void
  onLineFree: () => void
  onRequestCallback: () => void
  hotelId: string
  currentRoomId: string
  roomNumber: string
  hotelPhone?: string | null
}

export default function OngoingCallNoticeModal({
  isOpen,
  onClose,
  onLineFree,
  onRequestCallback,
  hotelId,
  currentRoomId,
  roomNumber,
  hotelPhone,
}: OngoingCallNoticeModalProps) {
  const theme = useGuestTheme()
  const [queueState, setQueueState] = useState<HotelCallQueueState | null>(null)
  const [secondsWaiting, setSecondsWaiting] = useState(0)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Timer while waiting
  useEffect(() => {
    if (!isOpen) {
      setSecondsWaiting(0)
      return
    }

    const timer = setInterval(() => {
      setSecondsWaiting((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [isOpen])

  // Subscribe to real-time hotel call status
  useEffect(() => {
    if (!isOpen || !hotelId) return

    const unsubscribe = subscribeToCallQueue(
      hotelId,
      (state) => {
        if (!isMountedRef.current) return
        setQueueState(state)

        // If active call finished and no pending calls ahead, line is free!
        if (!state.hasActiveCall) {
          onLineFree()
        }
      },
      currentRoomId
    )

    return () => {
      unsubscribe()
    }
  }, [isOpen, hotelId, currentRoomId, onLineFree])

  if (!isOpen) return null

  const formatWaitTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const queuePosition = queueState?.currentRoomQueuePosition ?? 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 space-y-5 text-center animate-fade-up shadow-2xl"
        style={{
          background: 'var(--gw-surface, #1e293b)',
          border: '1px solid var(--gw-border, rgba(255, 255, 255, 0.12))',
        }}
      >
        {/* Pulsing Call In Progress Icon */}
        <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-2xl animate-ping opacity-25"
            style={{ background: 'rgba(245, 158, 11, 0.3)' }}
          />
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg relative z-10"
            style={{
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
            }}
          >
            ⏳
          </div>
        </div>

        <div>
          <span
            className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase mb-2"
            style={{
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            Front Desk Line Busy
          </span>
          <h2
            className="text-xl font-bold"
            style={{ color: 'var(--gw-text, #ffffff)' }}
          >
            Staff is on Another Call
          </h2>
          <p
            className="text-xs mt-1.5 leading-relaxed"
            style={{ color: 'var(--gw-text-2, #94a3b8)' }}
          >
            Our front desk is currently speaking with another guest. While you wait, you can request a callback or dial us directly — your call will auto-connect as soon as the line is free.
          </p>
        </div>

        {/* Live Queue Status Box */}
        <div
          className="p-4 rounded-2xl text-left text-xs space-y-3"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--gw-text-2, #94a3b8)' }}>Your Room</span>
            <span className="font-semibold text-white">Room {roomNumber}</span>
          </div>

          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--gw-text-2, #94a3b8)' }}>Queue Status</span>
            <span className="font-semibold text-amber-300 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {queuePosition === 1 ? 'Next in line' : `#${queuePosition} in line`}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--gw-text-2, #94a3b8)' }}>Waiting Time</span>
            <span className="font-mono font-medium text-white">{formatWaitTime(secondsWaiting)}</span>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          {/* Option A: Request Staff Callback */}
          <button
            type="button"
            onClick={onRequestCallback}
            className="w-full py-3 px-4 rounded-2xl font-bold text-xs text-white transition-all shadow-md flex items-center justify-center gap-2"
            style={{
              background: `linear-gradient(135deg, ${theme.primaryHex || '#6366f1'}, ${theme.secondaryHex || '#8b5cf6'})`,
            }}
          >
            <span>🛎️</span>
            <span>Request Staff Callback</span>
          </button>

          {/* Option B: Call Front Desk Directly (only shown if hotelPhone is available) */}
          {hotelPhone && (
            <a
              href={`tel:${hotelPhone}`}
              className="w-full py-3 px-4 rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2"
              style={{
                background: 'rgba(251, 191, 36, 0.12)',
                border: '1px solid rgba(251, 191, 36, 0.35)',
                color: '#fbbf24',
              }}
            >
              <span>📞</span>
              <span>Call Front Desk Directly</span>
            </a>
          )}

          {/* Option C: Cancel & Return */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl border text-xs font-semibold hover:bg-white/10 transition-colors"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              color: 'var(--gw-text-2, #94a3b8)',
            }}
          >
            Cancel & Return
          </button>
        </div>
      </div>
    </div>
  )
}
