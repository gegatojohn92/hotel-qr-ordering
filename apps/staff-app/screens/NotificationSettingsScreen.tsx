import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NotifPrefs {
  mute_guest_chat_push: boolean
  suppress_push_when_active: boolean
  quiet_hours_from_override: number | null
  quiet_hours_to_override: number | null
}

const DEFAULT_PREFS: NotifPrefs = {
  mute_guest_chat_push: false,
  suppress_push_when_active: true,
  quiet_hours_from_override: null,
  quiet_hours_to_override: null,
}

interface NotificationSettingsScreenProps {
  staffUserId: string
  staffName: string
  onBack: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen({
  staffUserId,
  staffName,
  onBack,
}: NotificationSettingsScreenProps) {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [personalQuietEnabled, setPersonalQuietEnabled] = useState(false)
  const [quietFrom, setQuietFrom] = useState('22')
  const [quietTo, setQuietTo] = useState('7')
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // ── Load current preferences ──────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await (supabase as any)
          .from('staff_users')
          .select(
            'mute_guest_chat_push, suppress_push_when_active, quiet_hours_from_override, quiet_hours_to_override'
          )
          .eq('id', staffUserId)
          .maybeSingle()

        if (!error && data) {
          const loaded: NotifPrefs = {
            mute_guest_chat_push:      data.mute_guest_chat_push      ?? false,
            suppress_push_when_active: data.suppress_push_when_active ?? true,
            quiet_hours_from_override: data.quiet_hours_from_override ?? null,
            quiet_hours_to_override:   data.quiet_hours_to_override   ?? null,
          }
          setPrefs(loaded)
          if (loaded.quiet_hours_from_override != null && loaded.quiet_hours_to_override != null) {
            setPersonalQuietEnabled(true)
            setQuietFrom(String(loaded.quiet_hours_from_override))
            setQuietTo(String(loaded.quiet_hours_to_override))
          }
        }
      } catch (err) {
        console.warn('[NotifSettings] Load failed:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [staffUserId])

  // ── Save to Supabase ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const fromVal = personalQuietEnabled ? parseInt(quietFrom, 10) : null
      const toVal   = personalQuietEnabled ? parseInt(quietTo, 10)   : null

      if (personalQuietEnabled) {
        if (isNaN(fromVal!) || fromVal! < 0 || fromVal! > 23) {
          Alert.alert('Invalid Input', 'Quiet hours "From" must be a number between 0 and 23.')
          setSaving(false)
          return
        }
        if (isNaN(toVal!) || toVal! < 0 || toVal! > 23) {
          Alert.alert('Invalid Input', 'Quiet hours "To" must be a number between 0 and 23.')
          setSaving(false)
          return
        }
      }

      const update: Record<string, any> = {
        mute_guest_chat_push:      prefs.mute_guest_chat_push,
        suppress_push_when_active: prefs.suppress_push_when_active,
        quiet_hours_from_override: fromVal,
        quiet_hours_to_override:   toVal,
      }

      const { error } = await (supabase as any)
        .from('staff_users')
        .update(update)
        .eq('id', staffUserId)

      if (error) throw error

      setToastMsg('Preferences saved ✓')
      setTimeout(() => setToastMsg(null), 2500)
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not save preferences. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [prefs, personalQuietEnabled, quietFrom, quietTo, staffUserId])

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator size="large" color="#818cf8" />
        <Text style={styles.loadingText}>Loading preferences…</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityLabel="Back">
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🔔 Notification Settings</Text>
          <Text style={styles.headerSub}>{staffName}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ── Section: Guest Chat Pushes ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GUEST CHAT PUSH NOTIFICATIONS</Text>

          {/* Mute all */}
          <View style={styles.settingRow}>
            <View style={styles.settingLabelBlock}>
              <Text style={styles.settingLabel}>🔇 Mute All Guest Chat Pushes</Text>
              <Text style={styles.settingDesc}>
                Completely stop receiving FCM push notifications for guest chat events on this account.
                Other notification types (food, spa, calls) are unaffected.
              </Text>
            </View>
            <Switch
              value={prefs.mute_guest_chat_push}
              onValueChange={(v) => setPrefs((p) => ({ ...p, mute_guest_chat_push: v }))}
              trackColor={{ false: '#334155', true: '#ef4444' }}
              thumbColor={prefs.mute_guest_chat_push ? '#fca5a5' : '#94a3b8'}
            />
          </View>

          {/* Suppress while viewing */}
          <View style={[styles.settingRow, prefs.mute_guest_chat_push && styles.settingRowDisabled]}>
            <View style={styles.settingLabelBlock}>
              <Text style={[styles.settingLabel, prefs.mute_guest_chat_push && styles.textDisabled]}>
                👁 Suppress While Viewing Chat
              </Text>
              <Text style={[styles.settingDesc, prefs.mute_guest_chat_push && styles.textDisabled]}>
                Hold the push notification when you are actively reading or replying to that exact
                conversation. You will still receive pushes for other conversations.
              </Text>
            </View>
            <Switch
              value={prefs.suppress_push_when_active}
              onValueChange={(v) => setPrefs((p) => ({ ...p, suppress_push_when_active: v }))}
              disabled={prefs.mute_guest_chat_push}
              trackColor={{ false: '#334155', true: '#4f46e5' }}
              thumbColor={prefs.suppress_push_when_active ? '#a5b4fc' : '#94a3b8'}
            />
          </View>
        </View>

        {/* ── Section: Personal Quiet Hours ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PERSONAL QUIET HOURS</Text>
          <Text style={styles.sectionHint}>
            Override the hotel-wide quiet hours setting for your account only.
            No guest chat pushes will be sent during your quiet window.
          </Text>

          {/* Enable toggle */}
          <View style={styles.settingRow}>
            <View style={styles.settingLabelBlock}>
              <Text style={styles.settingLabel}>🌙 Enable Personal Quiet Hours</Text>
              <Text style={styles.settingDesc}>
                When enabled, your custom quiet window takes effect instead of the hotel default.
              </Text>
            </View>
            <Switch
              value={personalQuietEnabled}
              onValueChange={setPersonalQuietEnabled}
              trackColor={{ false: '#334155', true: '#0891b2' }}
              thumbColor={personalQuietEnabled ? '#67e8f9' : '#94a3b8'}
            />
          </View>

          {/* From / To inputs */}
          {personalQuietEnabled && (
            <View style={styles.timeInputRow}>
              <View style={styles.timeInputGroup}>
                <Text style={styles.timeLabel}>From (hour, 0–23)</Text>
                <TextInput
                  style={styles.timeInput}
                  value={quietFrom}
                  onChangeText={setQuietFrom}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholderTextColor="#475569"
                  placeholder="22"
                />
              </View>
              <Text style={styles.timeArrow}>→</Text>
              <View style={styles.timeInputGroup}>
                <Text style={styles.timeLabel}>To (hour, 0–23)</Text>
                <TextInput
                  style={styles.timeInput}
                  value={quietTo}
                  onChangeText={setQuietTo}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholderTextColor="#475569"
                  placeholder="7"
                />
              </View>
            </View>
          )}

          {personalQuietEnabled && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ℹ️ Example: From 22, To 7 = No pushes from 10 PM to 7 AM (overnight window).
                From 9, To 17 = No pushes from 9 AM to 5 PM.
              </Text>
            </View>
          )}
        </View>

        {/* ── Info Box ── */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💡 These are per-account preferences. Hotel-wide settings (e.g., cooldown, hotel quiet hours)
            are configured by the Admin in the web portal and apply to all staff.
          </Text>
        </View>

        {/* ── Save Button ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityLabel="Save notification preferences"
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Preferences</Text>
          )}
        </TouchableOpacity>

        {/* Reset link */}
        <TouchableOpacity
          style={styles.resetBtn}
          onPress={() => {
            setPrefs({ mute_guest_chat_push: false, suppress_push_when_active: true, quiet_hours_from_override: null, quiet_hours_to_override: null })
            setPersonalQuietEnabled(false)
            setQuietFrom('22')
            setQuietTo('7')
          }}
        >
          <Text style={styles.resetBtnText}>Reset to Defaults</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Toast */}
      {toastMsg && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  centerFill: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backBtn: {
    paddingVertical: 6,
    paddingRight: 12,
    minWidth: 60,
  },
  backBtnText: {
    color: '#818cf8',
    fontSize: 15,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSub: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  headerRight: {
    minWidth: 60,
  },

  // ── Scroll ─────────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },

  // ── Section ────────────────────────────────────────────────────────────────
  section: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
    marginBottom: 4,
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  sectionHint: {
    color: '#475569',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    lineHeight: 17,
  },

  // ── Setting Row ────────────────────────────────────────────────────────────
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#0f172a',
    gap: 12,
  },
  settingRowDisabled: {
    opacity: 0.4,
  },
  settingLabelBlock: {
    flex: 1,
    gap: 4,
  },
  settingLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  settingDesc: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  textDisabled: {
    color: '#475569',
  },

  // ── Time Inputs ────────────────────────────────────────────────────────────
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  timeInputGroup: {
    flex: 1,
    gap: 6,
  },
  timeLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  timeInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  timeArrow: {
    color: '#475569',
    fontSize: 20,
    marginTop: 18,
  },

  // ── Info Box ───────────────────────────────────────────────────────────────
  infoBox: {
    backgroundColor: 'rgba(14,165,233,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(14,165,233,0.2)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
  },
  infoText: {
    color: '#7dd3fc',
    fontSize: 12,
    lineHeight: 18,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  saveBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  resetBtnText: {
    color: '#475569',
    fontSize: 13,
  },

  // ── Toast ──────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  toastText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
})
