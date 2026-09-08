'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

const supabase = createSupabaseBrowserClient()

interface PhoneCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (phone: string, sessionId?: string) => void
  roomId: string
  hotelId: string
  title?: string
  description?: string
}

export const GUEST_PHONE_STORAGE_KEY = 'hotel_guest_phone_number'

export function generateClientSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
  } catch {
    // fallback below
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getStoredGuestPhone(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(GUEST_PHONE_STORAGE_KEY)
}

export function storeGuestPhone(phone: string): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(GUEST_PHONE_STORAGE_KEY, phone)
}

export function getStoredGuestSessionId(roomId: string): string | null {
  if (typeof window === 'undefined' || !roomId) return null
  return sessionStorage.getItem(`hotel_guest_session_${roomId}`)
}

export function getOrCreateGuestSessionId(roomId: string): string {
  if (typeof window === 'undefined' || !roomId) return generateClientSessionId()
  const existing = sessionStorage.getItem(`hotel_guest_session_${roomId}`)
  if (existing) return existing
  const newId = generateClientSessionId()
  sessionStorage.setItem(`hotel_guest_session_${roomId}`, newId)
  return newId
}

export function storeGuestSessionId(roomId: string, sessionId: string): void {
  if (typeof window === 'undefined' || !roomId) return
  sessionStorage.setItem(`hotel_guest_session_${roomId}`, sessionId)
}

export function getStoredGuestConversationId(roomId: string): string | null {
  if (typeof window === 'undefined' || !roomId) return null
  return sessionStorage.getItem(`hotel_guest_chat_conv_${roomId}`)
}

export function storeGuestConversationId(roomId: string, convId: string): void {
  if (typeof window === 'undefined' || !roomId || !convId) return
  sessionStorage.setItem(`hotel_guest_chat_conv_${roomId}`, convId)
}

export default function PhoneCaptureModal({
  isOpen,
  onClose,
  onSuccess,
  roomId,
  hotelId,
  title = 'Contact Information',
  description = 'Please enter your mobile phone number so our staff can notify you about your request status.',
}: PhoneCaptureModalProps) {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = phoneNumber.trim()
    if (!cleaned || cleaned.length < 7) {
      setErrorMsg('Please enter a valid phone number.')
      return
    }

    setSaving(true)
    setErrorMsg(null)

    let createdSessionId: string | undefined = undefined

    try {
      // 1. Store in client sessionStorage
      storeGuestPhone(cleaned)

      // 2. Insert/Update guest_sessions in Supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('guest_sessions')
        .insert([
          {
            room_id: roomId,
            hotel_id: hotelId,
            phone_number: cleaned,
            status: 'ACTIVE',
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        ])
        .select('id')
        .single()

      if (error) {
        console.warn('Guest session insert notice:', error.message)
        createdSessionId = generateClientSessionId()
        storeGuestSessionId(roomId, createdSessionId)
      } else if (data?.id) {
        createdSessionId = data.id
        storeGuestSessionId(roomId, data.id)
      } else {
        createdSessionId = generateClientSessionId()
        storeGuestSessionId(roomId, createdSessionId)
      }

      onSuccess(cleaned, createdSessionId)
    } catch (err) {
      console.error('Error saving phone session:', err)
      if (!createdSessionId) {
        createdSessionId = generateClientSessionId()
        storeGuestSessionId(roomId, createdSessionId)
      }
      onSuccess(cleaned, createdSessionId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 space-y-5 text-center animate-fade-up"
        style={{ background: 'var(--gw-bg)', border: '1px solid rgba(255, 255, 255, 0.12)' }}
      >
        <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-3xl"
             style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
          📱
        </div>

        <div>
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            {description}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="tel"
              placeholder="+63 917 123 4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-white/5 border border-white/15 text-white text-center text-lg font-semibold placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              autoFocus
              required
            />
            {errorMsg && <p className="text-red-400 text-xs mt-2">{errorMsg}</p>}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !phoneNumber.trim()}
              className="flex-[2] py-3 rounded-2xl font-bold text-sm text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              {saving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
