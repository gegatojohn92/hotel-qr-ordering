'use client'

import { useState, useEffect } from 'react'
import type { Database } from '@hotel-qr/supabase/types'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { GUEST_THEMES, GuestColorScheme, getGuestTheme } from '@/lib/guest-theme'

const supabase = createSupabaseBrowserClient()

const HOTEL_ID = '00000000-0000-0000-0000-000000000001'

const LOGO_PRESETS = [
  { id: 'crown', label: '👑 Luxury Crown', url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=120' },
  { id: 'palace', label: '🏨 Grand Palace', url: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=120' },
  { id: 'resort', label: '🌊 Seaside Resort', url: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=120' },
  { id: 'palm', label: '🌴 Tropical Palms', url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=120' },
  { id: 'tower', label: '🏙️ Modern Tower', url: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=120' },
]

export default function HotelSettingsPage() {
  const [hotelName, setHotelName] = useState('Hotel')
  const [phone, setPhone] = useState('+1-800-555-0100')
  const [fnbPhoneNumber, setFnbPhoneNumber] = useState('+1-800-555-0199')
  const [logoUrl, setLogoUrl] = useState('https://images.unsplash.com/photo-1566073771259-6a8506099945?w=120')
  const [colorScheme, setColorScheme] = useState<GuestColorScheme>('gold')

  // Service Charge Settings
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(true)
  const [serviceChargePct, setServiceChargePct]         = useState<number>(10)

  // Notification & Alarm Settings
  const [reminderInterval, setReminderInterval]         = useState<number>(5)
  const [enableSoundAlert, setEnableSoundAlert]         = useState<boolean>(true)
  const [maxAlertDuration, setMaxAlertDuration]         = useState<number>(30)
  const [fnbAllowedTypes, setFnbAllowedTypes]           = useState<string[]>(['FOOD_ORDER'])
  const [frontdeskAllowedTypes, setFrontdeskAllowedTypes] = useState<string[]>(['CALL_REQUEST', 'TASK'])
  const [spaAllowedTypes, setSpaAllowedTypes]           = useState<string[]>(['SPA_BOOKING'])
  const [functionRoomNotificationEnabled, setFunctionRoomNotificationEnabled] = useState<boolean>(true)
  const [functionRoomLeadDays, setFunctionRoomLeadDays] = useState<number>(1)
  const [guestLiveCallEnabled, setGuestLiveCallEnabled] = useState<boolean>(true)

  // Test Push State
  const [testPushLoading, setTestPushLoading] = useState(false)
  const [testPushResult, setTestPushResult] = useState<{ success?: boolean; message?: string } | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Fetch current hotel settings & notification settings from Supabase
  useEffect(() => {
    async function loadHotelSettings() {
      setLoading(true)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [hotelRes, notifRes] = await Promise.all([
          (supabase as any)
            .from('hotels')
            .select('name, phone, fnb_phone_number, logo_url, color_scheme, service_charge_enabled, service_charge_pct')
            .eq('id', HOTEL_ID)
            .single(),
          (supabase as any)
            .from('notification_settings')
            .select('*')
            .eq('hotel_id', HOTEL_ID)
            .maybeSingle(),
        ])

        if (hotelRes.error && hotelRes.error.code !== 'PGRST116') {
          console.error('Failed to load hotel settings:', hotelRes.error)
        }

        if (hotelRes.data) {
          const data = hotelRes.data
          if (data.name) setHotelName(data.name)
          if (data.phone) setPhone(data.phone)
          if (data.fnb_phone_number) setFnbPhoneNumber(data.fnb_phone_number)
          if (data.logo_url) setLogoUrl(data.logo_url)
          if (data.color_scheme) setColorScheme(data.color_scheme as GuestColorScheme)
          setServiceChargeEnabled(data.service_charge_enabled ?? true)
          setServiceChargePct(Number(data.service_charge_pct ?? 10))
        }

        if (notifRes.data) {
          const nData = notifRes.data
          if (typeof nData.reminder_interval_minutes === 'number') setReminderInterval(nData.reminder_interval_minutes)
          if (typeof nData.enable_sound_alert === 'boolean') setEnableSoundAlert(nData.enable_sound_alert)
          if (typeof nData.max_alert_duration_seconds === 'number') setMaxAlertDuration(nData.max_alert_duration_seconds)
          if (Array.isArray(nData.fnb_allowed_types)) setFnbAllowedTypes(nData.fnb_allowed_types)
          if (Array.isArray(nData.frontdesk_allowed_types)) setFrontdeskAllowedTypes(nData.frontdesk_allowed_types)
          if (Array.isArray(nData.spa_allowed_types)) setSpaAllowedTypes(nData.spa_allowed_types)
          if (typeof nData.notify_same_day === 'boolean') setFunctionRoomNotificationEnabled(nData.notify_same_day)
          if (typeof nData.notify_days_before === 'number') setFunctionRoomLeadDays(nData.notify_days_before)
          if (typeof nData.enable_guest_live_call === 'boolean') setGuestLiveCallEnabled(nData.enable_guest_live_call)
        }
      } catch (err) {
        console.error('Error loading hotel data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadHotelSettings()
  }, [])

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setToastMessage(null)
    setErrorMessage(null)

    try {
      // 1. Update hotels table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: hotelErr } = await (supabase as any)
        .from('hotels')
        .update({
          name: hotelName.trim(),
          phone: phone.trim(),
          fnb_phone_number: fnbPhoneNumber.trim(),
          logo_url: logoUrl.trim(),
          color_scheme: colorScheme,
          service_charge_enabled: serviceChargeEnabled,
          service_charge_pct: serviceChargePct,
        })
        .eq('id', HOTEL_ID)

      if (hotelErr) throw hotelErr

      // 2. Upsert notification_settings table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: notifErr } = await (supabase as any)
        .from('notification_settings')
        .upsert({
          hotel_id: HOTEL_ID,
          reminder_interval_minutes: reminderInterval,
          enable_sound_alert: enableSoundAlert,
          max_alert_duration_seconds: maxAlertDuration,
          fnb_allowed_types: fnbAllowedTypes,
          frontdesk_allowed_types: frontdeskAllowedTypes,
          spa_allowed_types: spaAllowedTypes,
          notify_same_day: functionRoomNotificationEnabled,
          notify_days_before: functionRoomLeadDays,
          enable_guest_live_call: guestLiveCallEnabled,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'hotel_id' })

      if (notifErr) {
        console.warn('Could not save notification_settings:', notifErr)
      }

      // 3. Insert audit log record
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('audit_logs').insert([
        {
          hotel_id: HOTEL_ID,
          action: 'HOTEL_SETTINGS_UPDATED',
          details: {
            name: hotelName.trim(),
            phone: phone.trim(),
            fnb_phone_number: fnbPhoneNumber.trim(),
            logo_url: logoUrl.trim(),
            color_scheme: colorScheme,
            reminder_interval_minutes: reminderInterval,
            enable_sound_alert: enableSoundAlert,
            max_alert_duration_seconds: maxAlertDuration,
            function_room_notifications_enabled: functionRoomNotificationEnabled,
            function_room_lead_days: functionRoomLeadDays,
            guest_live_call_enabled: guestLiveCallEnabled,
          },
        },
      ])

      setToastMessage('Hotel & Notification settings saved successfully!')
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err: unknown) {
      console.error('Error saving hotel settings:', err)
      setErrorMessage((err as Error).message || 'Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleTriggerTestPush = async () => {
    setTestPushLoading(true)
    setTestPushResult(null)
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: HOTEL_ID,
          title: '🔔 Test Staff Notification',
          body: 'This is a test notification from the Admin Notification Settings panel.',
          requestType: 'TASK',
          roomNumber: 'Admin Panel',
          isTestPush: true,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setTestPushResult({
          success: true,
          message: `Dispatched to ${data.expoDevicesReached ?? 0} mobile device(s) and ${data.webSubscriptionsReached ?? 0} browser(s).`,
        })
      } else {
        setTestPushResult({
          success: false,
          message: data.error || data.message || 'Failed to send test push.',
        })
      }
    } catch (err: any) {
      setTestPushResult({
        success: false,
        message: err.message || 'Network error while triggering test push.',
      })
    } finally {
      setTestPushLoading(false)
    }
  }

  const selectedTheme = getGuestTheme(colorScheme)

  return (
    <main style={{ minHeight: '100vh', background: '#020617', color: '#f1f5f9', fontFamily: "'Inter', sans-serif", padding: '2rem' }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <a href="/admin" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none', fontWeight: 600 }}>
                ← Admin Dashboard
              </a>
              <span style={{ fontSize: 13, color: '#475569' }}>/</span>
              <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>⚙️ Hotel Settings</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>{hotelName} Settings</h1>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
              Configure property details, direct call contact info, logo image, and guest web app color scheme.
            </p>
          </div>

          <a
            href="/admin"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1', textDecoration: 'none', borderRadius: 12, padding: '10px 18px', fontWeight: 700, fontSize: 13 }}
          >
            Return to Portal
          </a>
        </div>

        {/* Success / Error Banners */}
        {toastMessage && (
          <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', padding: '12px 18px', borderRadius: 14, marginBottom: '1.5rem', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✅</span> {toastMessage}
          </div>
        )}
        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '12px 18px', borderRadius: 14, marginBottom: '1.5rem', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span> {errorMessage}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>Loading hotel settings...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '2rem' }}>
            {/* Form Column */}
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              {/* Hotel Basic Info Box */}
              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🏨</span> Basic Hotel Details
                </h3>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
                    Hotel Name
                  </label>
                  <input
                    type="text"
                    value={hotelName}
                    onChange={(e) => setHotelName(e.target.value)}
                    required
                    placeholder="e.g. Your Hotel Name"
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                    Appears in guest headers, welcome banners, and staff tablet alerts.
                  </span>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
                    Front Desk Phone Number (General Calling)
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="e.g. +1-800-555-0100"
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                    Used for general front desk inquiries and concierge requests.
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>
                    🍽️ F&amp;B / Dining Direct Phone Number
                  </label>
                  <input
                    type="text"
                    value={fnbPhoneNumber}
                    onChange={(e) => setFnbPhoneNumber(e.target.value)}
                    placeholder="e.g. +1-800-555-0199"
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(251,191,36,0.3)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      color: '#fbbf24',
                      fontWeight: '600',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
                    Guests tapping the Floating Call button in the Dining section will directly dial this kitchen / room service number.
                  </span>
                </div>
              </div>

              {/* Logo & Visual Branding Box */}
              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🖼️</span> Hotel Logo & Icon
                </h3>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
                    Logo Image URL
                  </label>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                    Or Pick a Preset Hotel Image:
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {LOGO_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setLogoUrl(preset.url)}
                        style={{
                          background: logoUrl === preset.url ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                          border: logoUrl === preset.url ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.08)',
                          color: logoUrl === preset.url ? '#fbbf24' : '#cbd5e1',
                          padding: '6px 12px',
                          borderRadius: 10,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Guest App Color Scheme Box */}
              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem' }}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>🎨</span> Guest App Color Scheme
                    </h3>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', padding: '2px 8px', borderRadius: 10 }}>
                      Guest Web UI Only
                    </span>
                  </div>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                    This color scheme dynamically styles the guest mobile web app (buttons, gradients, orbs, badges). Admin & staff interfaces remain unaffected.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.85rem' }}>
                  {Object.values(GUEST_THEMES).map((theme) => {
                    const isSelected = colorScheme === theme.id
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setColorScheme(theme.id)}
                        style={{
                          background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                          border: isSelected ? `2px solid ${theme.primaryHex}` : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 14,
                          padding: '12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Swatch Circle */}
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: theme.gradient,
                            boxShadow: `0 0 12px ${theme.glowRgba}`,
                            marginBottom: 8,
                          }}
                        />

                        <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#fff' : '#cbd5e1' }}>
                          {theme.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                          {theme.id.toUpperCase()}
                        </div>

                        {isSelected && (
                          <span style={{ position: 'absolute', top: 10, right: 10, color: theme.primaryHex, fontSize: 14 }}>
                            ✓
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Service Charge Box */}
              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>💳</span> Service Charge
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', padding: '2px 8px', borderRadius: 10 }}>
                    Dining Only
                  </span>
                </div>
                <p style={{ margin: '0 0 1.25rem', color: '#94a3b8', fontSize: 12 }}>
                  When enabled, a service charge is automatically added to all dining orders at checkout. Spa and other service requests are not affected.
                </p>

                {/* Enable / Disable Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>Apply Service Charge</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Toggle off to disable for all guests</div>
                  </div>
                  <button
                    type="button"
                    id="toggle-service-charge"
                    onClick={() => setServiceChargeEnabled(v => !v)}
                    style={{
                      position: 'relative',
                      width: 52,
                      height: 28,
                      borderRadius: 14,
                      border: 'none',
                      background: serviceChargeEnabled
                        ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                        : 'rgba(255,255,255,0.1)',
                      cursor: 'pointer',
                      transition: 'background 0.25s',
                      flexShrink: 0,
                      boxShadow: serviceChargeEnabled ? '0 0 12px rgba(34,197,94,0.35)' : 'none',
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: 3,
                      left: serviceChargeEnabled ? 27 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.25s',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>

                {/* Percentage Input */}
                <div style={{ marginBottom: '1.25rem', opacity: serviceChargeEnabled ? 1 : 0.4, transition: 'opacity 0.2s' }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
                    Service Charge Percentage (%)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      id="input-service-charge-pct"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={serviceChargePct}
                      disabled={!serviceChargeEnabled}
                      onChange={(e) => setServiceChargePct(Math.min(100, Math.max(0, Number(e.target.value))))}
                      style={{
                        width: 100,
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        padding: '10px 14px',
                        color: '#fff',
                        fontSize: 16,
                        fontWeight: 700,
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>% of subtotal</span>
                  </div>
                </div>

                {/* Live Preview */}
                <div style={{
                  background: serviceChargeEnabled ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${serviceChargeEnabled ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  transition: 'all 0.25s',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Live Preview</div>
                  {serviceChargeEnabled ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}>
                        <span>Subtotal</span><span>₱500.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#fbbf24' }}>
                        <span>Service Charge ({serviceChargePct}%)</span>
                        <span>+₱{(500 * serviceChargePct / 100).toFixed(2)}</span>
                      </div>
                      <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '4px 0' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#f97316', fontWeight: 800 }}>
                        <span>Total</span>
                        <span>₱{(500 + 500 * serviceChargePct / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>🚫</span>
                      <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Service charge disabled — guests pay subtotal only</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🏛️</span> Function Room Reminder Rules
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', padding: '2px 8px', borderRadius: 10 }}>
                    Event Alerts
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>Send same-day reminder</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Trigger a reminder on the booking day</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFunctionRoomNotificationEnabled(value => !value)}
                    style={{
                      position: 'relative',
                      width: 52,
                      height: 28,
                      borderRadius: 14,
                      border: 'none',
                      background: functionRoomNotificationEnabled ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'rgba(255,255,255,0.1)',
                      cursor: 'pointer',
                      transition: 'background 0.25s',
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: 3,
                      left: functionRoomNotificationEnabled ? 27 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.25s',
                    }} />
                  </button>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
                    Reminder lead time (days before event)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={14}
                    value={functionRoomLeadDays}
                    onChange={(e) => setFunctionRoomLeadDays(Math.min(14, Math.max(0, Number(e.target.value))))}
                    style={{
                      width: 120,
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      padding: '10px 14px',
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 700,
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                </div>
              </div>

              {/* Push & Sound Notification Controls */}
              <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 20, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🔔</span> Staff Push & Alarm Controls
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)', padding: '2px 8px', borderRadius: 10 }}>
                    Automated & Role-Based
                  </span>
                </div>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                  Configure dynamic reminder intervals, loud sound alerts, ring durations, and role-based notification routing for staff tablets & mobile devices.
                </p>

                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>🏛️ Function Room Reminders</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Configure pre-event reminders for banquets and private events</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFunctionRoomNotificationEnabled(value => !value)}
                      style={{
                        position: 'relative',
                        width: 52,
                        height: 28,
                        borderRadius: 14,
                        border: 'none',
                        background: functionRoomNotificationEnabled ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'rgba(255,255,255,0.1)',
                        cursor: 'pointer',
                        transition: 'background 0.25s',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute',
                        top: 3,
                        left: functionRoomNotificationEnabled ? 27 : 3,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.25s',
                      }} />
                    </button>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Reminder lead time (days before event)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={14}
                      value={functionRoomLeadDays}
                      onChange={(e) => setFunctionRoomLeadDays(Math.min(14, Math.max(0, Number(e.target.value))))}
                      style={{
                        width: 120,
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        padding: '10px 14px',
                        color: '#fff',
                        fontSize: 16,
                        fontWeight: 700,
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    />
                  </div>
                </div>

                {/* 0. Guest Live Voice Call Visibility Toggle */}
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>🎤 Guest Live Voice Call Button</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {guestLiveCallEnabled
                        ? 'Visible — guests can start a live in-browser voice call with staff'
                        : 'Hidden — guests only see direct dial & staff callback options'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: guestLiveCallEnabled ? '#4ade80' : '#94a3b8' }}>
                      {guestLiveCallEnabled ? 'Shown' : 'Hidden'}
                    </span>
                    <button
                      type="button"
                      id="toggle-guest-live-call"
                      onClick={() => setGuestLiveCallEnabled(v => !v)}
                      style={{
                        position: 'relative',
                        width: 48,
                        height: 26,
                        borderRadius: 13,
                        border: 'none',
                        background: guestLiveCallEnabled ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.1)',
                        cursor: 'pointer',
                        transition: 'background 0.25s',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute',
                        top: 3,
                        left: guestLiveCallEnabled ? 25 : 3,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.25s',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                      }} />
                    </button>
                  </div>
                </div>

                {/* 1. Reminder Interval & Sound Toggle in a 2-col grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  {/* Reminder Interval */}
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px' }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ⏰ Unhandled Reminder Interval
                    </label>
                    <select
                      id="select-reminder-interval"
                      value={reminderInterval}
                      onChange={(e) => setReminderInterval(Number(e.target.value))}
                      style={{
                        width: '100%',
                        background: 'rgba(2, 6, 23, 0.8)',
                        border: '1px solid rgba(255,255,255,0.14)',
                        borderRadius: 10,
                        padding: '10px 12px',
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <option value={1}>Every 1 Minute (Urgent / Active)</option>
                      <option value={2}>Every 2 Minutes</option>
                      <option value={5}>Every 5 Minutes (Standard Default)</option>
                      <option value={10}>Every 10 Minutes</option>
                      <option value={15}>Every 15 Minutes</option>
                      <option value={0}>Disabled (One-Time Alert Only)</option>
                    </select>
                    <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 11 }}>
                      {reminderInterval === 0 ? 'Popup displays once upon request arrival.' : `Re-prompts staff every ${reminderInterval} min until claimed.`}
                    </p>
                  </div>

                  {/* Sound Alarm Toggle */}
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        🔊 Loud Audio Alarm
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Play looping sound when request arrives</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: enableSoundAlert ? '#4ade80' : '#94a3b8' }}>
                        {enableSoundAlert ? 'Sound Enabled' : 'Silenced (Vibrate Only)'}
                      </span>
                      <button
                        type="button"
                        id="toggle-sound-alert"
                        onClick={() => setEnableSoundAlert(v => !v)}
                        style={{
                          position: 'relative',
                          width: 48,
                          height: 26,
                          borderRadius: 13,
                          border: 'none',
                          background: enableSoundAlert ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.1)',
                          cursor: 'pointer',
                          transition: 'background 0.25s',
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute',
                          top: 3,
                          left: enableSoundAlert ? 25 : 3,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left 0.25s',
                          boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                        }} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Max Alarm Duration Slider */}
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ⏱️ Max Alarm Ring Duration
                    </label>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>
                      {maxAlertDuration} seconds
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={120}
                    step={5}
                    value={maxAlertDuration}
                    onChange={(e) => setMaxAlertDuration(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#fbbf24', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 10, marginTop: 4 }}>
                    <span>10s (Short)</span>
                    <span>30s (Default)</span>
                    <span>60s</span>
                    <span>120s (Extended)</span>
                  </div>
                </div>

                {/* 3. Role Notification Matrix */}
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 14, padding: '14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    🛡️ Role Notification Routing Matrix
                  </div>
                  <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 11 }}>
                    Specify which request categories trigger push alerts for each staff role. (Admins & Managers always receive all alerts).
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* F&B Roles */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🍽️</span> F&B / Kitchen Staff
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {[
                          { id: 'FOOD_ORDER', label: 'Food Orders' },
                          { id: 'CALL_REQUEST', label: 'Calls' },
                          { id: 'TASK', label: 'Tasks' },
                        ].map((t) => {
                          const checked = fnbAllowedTypes.includes(t.id)
                          return (
                            <label key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: checked ? '#fff' : '#64748b', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) setFnbAllowedTypes([...fnbAllowedTypes, t.id])
                                  else setFnbAllowedTypes(fnbAllowedTypes.filter((x) => x !== t.id))
                                }}
                                style={{ accentColor: '#34d399' }}
                              />
                              {t.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    {/* Front Desk & Housekeeping */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🛎️</span> Front Desk & Housekeeping
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {[
                          { id: 'CALL_REQUEST', label: 'Calls' },
                          { id: 'GUEST_CHAT', label: 'Guest Chat' },
                          { id: 'CHAT_HANDOFF', label: 'Handoff' },
                          { id: 'TASK', label: 'Tasks' },
                          { id: 'FOOD_ORDER', label: 'Food' },
                          { id: 'SPA_BOOKING', label: 'Spa' },
                        ].map((t) => {
                          const checked = frontdeskAllowedTypes.includes(t.id)
                          return (
                            <label key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: checked ? '#fff' : '#64748b', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) setFrontdeskAllowedTypes([...frontdeskAllowedTypes, t.id])
                                  else setFrontdeskAllowedTypes(frontdeskAllowedTypes.filter((x) => x !== t.id))
                                }}
                                style={{ accentColor: '#60a5fa' }}
                              />
                              {t.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    {/* Spa Staff */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>💆</span> Spa Staff
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {[
                          { id: 'SPA_BOOKING', label: 'Spa Bookings' },
                          { id: 'CALL_REQUEST', label: 'Calls' },
                          { id: 'TASK', label: 'Tasks' },
                        ].map((t) => {
                          const checked = spaAllowedTypes.includes(t.id)
                          return (
                            <label key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: checked ? '#fff' : '#64748b', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) setSpaAllowedTypes([...spaAllowedTypes, t.id])
                                  else setSpaAllowedTypes(spaAllowedTypes.filter((x) => x !== t.id))
                                }}
                                style={{ accentColor: '#a78bfa' }}
                              />
                              {t.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Instant Test Push Dispatcher */}
                <div style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 14, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginBottom: 2 }}>
                      📡 Instant FCM Push Test
                    </div>
                    <div style={{ fontSize: 11, color: '#818cf8' }}>
                      Dispatch a high-priority test alert to all active staff devices right now.
                    </div>
                    {testPushResult && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: testPushResult.success ? '#4ade80' : '#f87171', marginTop: 6 }}>
                        {testPushResult.success ? '✓ ' : '✕ '} {testPushResult.message}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleTriggerTestPush}
                    disabled={testPushLoading}
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      opacity: testPushLoading ? 0.6 : 1,
                      boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
                    }}
                  >
                    {testPushLoading ? 'Sending Test Push...' : '🔔 Send Test Notification'}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={saving}
                style={{
                  background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: 14,
                  padding: '14px 24px',
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(251,191,36,0.3)',
                  transition: 'opacity 0.2s, transform 0.1s',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving Settings...' : '💾 Save Hotel Settings'}
              </button>
            </form>

            {/* Live Interactive Guest Mobile Preview Column */}
            <div>
              <div style={{ position: 'sticky', top: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>
                    📱 Live Guest UI Preview
                  </h3>
                  <span style={{ fontSize: 11, color: '#475569' }}>Real-time Mockup</span>
                </div>

                {/* Mobile Frame */}
                <div
                  style={{
                    background: '#020617',
                    border: '8px solid #1e293b',
                    borderRadius: 36,
                    padding: '24px 18px',
                    position: 'relative',
                    overflow: 'hidden',
                    minHeight: 520,
                    boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
                  }}
                >
                  {/* Decorative Background Orb */}
                  <div
                    style={{
                      position: 'absolute',
                      width: 240,
                      height: 240,
                      borderRadius: '50%',
                      background: selectedTheme.orbGradient,
                      top: -60,
                      right: -60,
                      opacity: 0.25,
                      filter: 'blur(40px)',
                      pointerEvents: 'none',
                    }}
                  />

                  {/* Mock Mobile Content */}
                  <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                    {/* Hotel Logo Avatar */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt="Hotel Logo"
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 18,
                            objectFit: 'cover',
                            border: `2px solid ${selectedTheme.primaryHex}`,
                            boxShadow: `0 0 16px ${selectedTheme.glowRgba}`,
                          }}
                          onError={(e) => {
                            // Fallback on image error
                            ;(e.target as HTMLElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 18,
                            background: selectedTheme.badgeBg,
                            border: `1px solid ${selectedTheme.badgeBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 32,
                          }}
                        >
                          🏨
                        </div>
                      )}
                    </div>

                    {/* Hotel Name */}
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
                      {hotelName || 'Hotel'}
                    </p>

                    {/* Welcome Title with Dynamic Theme Gradient */}
                    <h2 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 6px', color: '#fff' }}>
                      Welcome to <br />
                      <span
                        style={{
                          background: selectedTheme.gradient,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                        }}
                      >
                        Room 302
                      </span>
                    </h2>

                    <p style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>Deluxe Suite · Floor 3</p>

                    {/* Session Active Badge */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 14px', borderRadius: 20, background: selectedTheme.badgeBg, border: `1px solid ${selectedTheme.badgeBorder}`, color: selectedTheme.primaryHex, fontSize: 12, fontWeight: 700, marginBottom: 24 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: selectedTheme.primaryHex }} />
                      Session Active
                    </div>

                    {/* Action Buttons Mockup */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                      <button
                        type="button"
                        style={{
                          background: selectedTheme.gradient,
                          color: selectedTheme.id === 'slate' ? '#0f172a' : '#0f172a',
                          border: 'none',
                          borderRadius: 14,
                          padding: '12px',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        📞 Call Front Desk ({phone || 'No phone set'})
                      </button>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px', fontSize: 12, color: '#cbd5e1' }}>
                          🍽️ Dining Menu
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px', fontSize: 12, color: '#cbd5e1' }}>
                          💆 Spa Booking
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
