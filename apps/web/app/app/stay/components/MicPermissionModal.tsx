'use client'

import { useState } from 'react'
import { useGuestTheme } from './GuestThemeProvider'

interface MicPermissionModalProps {
  isOpen: boolean
  onClose: () => void
  onGranted: () => void
}

export default function MicPermissionModal({
  isOpen,
  onClose,
  onGranted,
}: MicPermissionModalProps) {
  const theme = useGuestTheme()
  const [isRequesting, setIsRequesting] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const [errorDetails, setErrorDetails] = useState<string | null>(null)

  if (!isOpen) return null

  const handleRequestPermission = async () => {
    setIsRequesting(true)
    setErrorDetails(null)

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support audio recording. Please update or use a modern browser.')
      }

      // Explicitly request audio stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Immediately release temporary microphone stream
      stream.getTracks().forEach((track) => track.stop())

      setIsRequesting(false)
      setIsBlocked(false)
      onGranted()
    } catch (err: unknown) {
      console.warn('[MicPermissionModal] Permission request failed:', err)
      setIsRequesting(false)

      const errorName = (err as { name?: string })?.name || ''
      const errorMessage = (err as { message?: string })?.message || ''

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError' ||
        errorMessage.toLowerCase().includes('denied') ||
        errorMessage.toLowerCase().includes('dismissed')
      ) {
        setIsBlocked(true)
        setErrorDetails('Microphone access was blocked or dismissed.')
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setErrorDetails('No microphone was detected on this device. Please connect a headset or mic.')
      } else {
        setErrorDetails(errorMessage || 'Microphone access is required to speak with staff.')
      }
    }
  }

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
        <div
          className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-3xl transition-transform"
          style={{
            background: isBlocked ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${isBlocked ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
          }}
        >
          {isBlocked ? '🎙️❌' : '🎙️'}
        </div>

        <div>
          <h2
            className="text-xl font-bold"
            style={{ color: 'var(--gw-text, #ffffff)' }}
          >
            {isBlocked ? 'Microphone Access Blocked' : 'Microphone Permission Needed'}
          </h2>
          <p
            className="text-xs mt-1.5 leading-relaxed"
            style={{ color: 'var(--gw-text-2, #94a3b8)' }}
          >
            {isBlocked
              ? 'Your browser blocked microphone access for this website. To talk with our front desk staff, please enable microphone in your browser settings.'
              : 'Live voice calls require your microphone so you can speak directly with front desk staff.'}
          </p>
        </div>

        {errorDetails && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs text-left">
            {errorDetails}
          </div>
        )}

        {isBlocked ? (
          <div
            className="p-4 rounded-2xl text-left text-xs space-y-2.5"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--gw-text-2, #cbd5e1)',
            }}
          >
            <div className="font-semibold text-white flex items-center gap-1.5">
              <span>🔧 How to unblock:</span>
            </div>
            <ul className="list-disc list-inside space-y-1.5 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">Chrome / Edge:</strong> Tap the lock/tune icon <span className="text-amber-300">🔒</span> next to the URL bar → tap <span className="text-white">Permissions</span> → set <span className="text-emerald-400">Microphone</span> to <strong>Allow</strong>.
              </li>
              <li>
                <strong className="text-white">iOS Safari:</strong> Tap <span className="text-amber-300">aA</span> in the address bar → <span className="text-white">Website Settings</span> → <span className="text-emerald-400">Microphone</span> → <strong>Allow</strong>.
              </li>
              <li>
                <strong className="text-white">Android Chrome:</strong> Tap <span className="text-amber-300">⋮</span> → <span className="text-white">Settings</span> → <span className="text-white">Site settings</span> → <span className="text-emerald-400">Microphone</span>.
              </li>
            </ul>
          </div>
        ) : (
          <div
            className="p-3 rounded-2xl text-xs flex items-center gap-2.5 text-left"
            style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              color: '#93c5fd',
            }}
          >
            <span className="text-lg">ℹ️</span>
            <span>Tap &quot;Allow&quot; when your browser shows the microphone permission prompt.</span>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border font-semibold text-xs hover:bg-white/10 transition-colors"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderColor: 'rgba(255, 255, 255, 0.12)',
              color: 'var(--gw-text-2, #94a3b8)',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleRequestPermission}
            disabled={isRequesting}
            className="flex-[2] py-3 rounded-2xl font-bold text-xs text-white transition-all disabled:opacity-50 shadow-lg"
            style={{
              background: isBlocked
                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                : `linear-gradient(135deg, ${theme.primaryHex || '#10b981'}, ${theme.secondaryHex || '#059669'})`,
            }}
          >
            {isRequesting ? 'Requesting...' : isBlocked ? 'Try Again After Enabling' : 'Allow Microphone'}
          </button>
        </div>
      </div>
    </div>
  )
}
