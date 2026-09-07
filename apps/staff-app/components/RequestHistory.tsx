import React, { useEffect, useState, useCallback } from 'react'
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Modal,
  Linking,
  Alert,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { useAutoSync } from '../lib/useAutoSync'

export interface HistoricalRequest {
  id: string
  request_type: string
  status: string
  payload: Record<string, any>
  created_at: string
  claimed_by?: string | null
  rooms?: { room_number: string } | null
}

interface AuditLog {
  id: string
  hotel_id: string
  request_id: string | null
  action: string
  actor_id: string | null
  details: Record<string, any>
  created_at: string
}

const HOTEL_ID = '00000000-0000-0000-0000-000000000001'

type RoomSortOrder = 'asc' | 'desc'
type DateSortOrder = 'desc' | 'asc'
type FilterType = 'ALL' | 'FOOD_ORDER' | 'SPA_BOOKING' | 'CALL_REQUEST' | 'TASK' | 'FUNCTION_ROOM_BOOKING'

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return ''
    const diffMs = Date.now() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function RequestHistory({ refreshTrigger }: { refreshTrigger?: number } = {}) {
  const [requests, setRequests] = useState<HistoricalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [staffMap, setStaffMap] = useState<Record<string, string>>({})
  const [roomSort, setRoomSort] = useState<RoomSortOrder>('asc')
  const [dateSort, setDateSort] = useState<DateSortOrder>('desc')
  const [activeSortType, setActiveSortType] = useState<'DATE' | 'ROOM'>('DATE')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAccordionOpen, setIsAccordionOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState<FilterType>('ALL')

  // Detail panel state
  const [selectedRequest, setSelectedRequest] = useState<HistoricalRequest | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditLog[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  const fetchStaffMap = useCallback(async () => {
    try {
      const { data } = await (supabase as any)
        .from('staff_users')
        .select('id, full_name')
        .eq('hotel_id', HOTEL_ID)
      if (data) {
        const map: Record<string, string> = {}
        ;(data as any[]).forEach((s) => { if (s.id && s.full_name) map[s.id] = s.full_name })
        setStaffMap(map)
      }
    } catch (err) {
      console.warn('[RequestHistory] staff_users fetch non-fatal:', err)
    }
  }, [])

  const fetchHistory = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    try {
      const { data, error } = await (supabase.from('requests') as any)
        .select('*, rooms(room_number)')
        .eq('hotel_id', HOTEL_ID)
        .order('created_at', { ascending: false })

      if (!error && data) {
        setRequests(data as HistoricalRequest[])
      }
    } catch (err) {
      console.error('Error fetching request history:', err)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [])

  const fetchRef = React.useRef(fetchHistory)
  useEffect(() => {
    fetchRef.current = fetchHistory
  }, [fetchHistory])

  // ─── Automated Polling & Focus Synchronization ─────────────
  useAutoSync(() => fetchRef.current(true), { intervalMs: 8000 })

  // ─── Triggered from Parent App Event Bus ───────────────────
  const isFirstRender = React.useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    fetchRef.current(true)
  }, [refreshTrigger])

  useEffect(() => {
    fetchStaffMap()
    fetchRef.current()

    const channel = supabase
      .channel('history-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
        fetchRef.current(true)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, () => {
        fetchRef.current(true)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          fetchRef.current(true)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchStaffMap])

  const handleSelectRequest = async (req: HistoricalRequest) => {
    setSelectedRequest(req)
    setAuditTrail([])
    setLoadingAudit(true)
    try {
      const { data, error } = await (supabase as any)
        .from('audit_logs')
        .select('*')
        .eq('hotel_id', HOTEL_ID)
        .eq('request_id', req.id)
        .order('created_at', { ascending: true })

      if (!error && data) {
        setAuditTrail(data as AuditLog[])
      }
    } catch (err) {
      console.warn('[RequestHistory] audit_logs fetch non-fatal:', err)
    } finally {
      setLoadingAudit(false)
    }
  }

  // Sort + filter
  const filtered = requests.filter(r => typeFilter === 'ALL' || r.request_type === typeFilter)

  const sortedRequests = [...filtered].sort((a, b) => {
    if (activeSortType === 'ROOM') {
      const rA = parseInt(a.rooms?.room_number || '0', 10)
      const rB = parseInt(b.rooms?.room_number || '0', 10)
      return roomSort === 'asc' ? rA - rB : rB - rA
    } else {
      const tA = new Date(a.created_at).getTime()
      const tB = new Date(b.created_at).getTime()
      return dateSort === 'desc' ? tB - tA : tA - tB
    }
  })

  const displayedRequests = isExpanded ? sortedRequests : sortedRequests.slice(0, 5)

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'RESOLVED':
      case 'CONFIRMED':
        return { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', label: '✓ RESOLVED' }
      case 'DECLINED':
      case 'CANCELLED':
        return { bg: 'rgba(239,68,68,0.15)', color: '#f87171', label: '✕ DECLINED' }
      case 'CLAIMED':
      case 'PREPARING':
        return { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: '⏳ IN PROGRESS' }
      default:
        return { bg: 'rgba(250,204,21,0.15)', color: '#facc15', label: '🟡 PENDING' }
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'CALL_REQUEST': return '📞'
      case 'SPA_BOOKING':  return '💆'
      case 'FOOD_ORDER':   return '🍽️'
      case 'FUNCTION_ROOM_BOOKING': return '🏛️'
      default:             return '🧹'
    }
  }

  const getTypeSummary = (item: HistoricalRequest) => {
    const p = item.payload as any
    switch (item.request_type) {
      case 'FOOD_ORDER':   return `Food Order · ₱${p?.total_price || 0}`
      case 'SPA_BOOKING':  return `Spa: ${p?.service_name || 'Treatment'}`
      case 'CALL_REQUEST': return 'Callback Alert'
      case 'TASK':         return p?.task_name || 'Room Request'
      case 'FUNCTION_ROOM_BOOKING': {
        const roomNames = p?.room_names || p?.room_name || 'Function room'
        return `Function Room Booking · ${roomNames}`
      }
      default:             return item.request_type
    }
  }

  // Resolve actor from audit trail or request payload
  const resolveActorFromRequest = (req: HistoricalRequest) => {
    const p = req.payload as any

    // 1. If a staff member has claimed/handled this request, prefer their name from staffMap
    const claimedStaffName = req.claimed_by ? (staffMap[req.claimed_by] || null) : null
    if (claimedStaffName) {
      return { name: claimedStaffName, role: 'STAFF' }
    }

    // 2. Check payload for an explicit staff actor set during manual operations/edits
    const payloadStaffName =
      p?.last_modified_by ||
      p?.modified_by_staff_name ||
      (p?.manual_booking ? (p?.booked_by || 'Front Desk Staff') : null) ||
      null
    if (payloadStaffName) {
      return { name: payloadStaffName, role: p?.manual_booking ? 'FRONT_DESK' : 'STAFF' }
    }

    // 3. claimed_by UUID exists on request but not found in staffMap yet
    if (req.claimed_by) {
      return { name: 'Front Desk Staff', role: 'STAFF' }
    }

    // 4. No staff claimed it — it's a guest-initiated request!
    const roomNum = req.rooms?.room_number || p?.room_number || p?.room
    let guestName = 'Guest'
    if (p?.booked_by) {
      guestName = p.booked_by
    } else if (p?.claimed_by_name) {
      guestName = p.claimed_by_name
    } else if (roomNum) {
      guestName = `Guest (Room ${roomNum})`
    }

    return { name: guestName, role: 'GUEST' }
  }

  const resolveActorFromLog = (log: AuditLog) => {
    const d = log.details || {}
    let name =
      d.actor_name ||
      d.modified_by ||
      d.approved_by ||
      d.cancelled_by ||
      d.completed_by ||
      d.claimed_by_name ||
      null

    let role = d.actor_role || null

    if (!name) {
      if (role === 'GUEST' || !role) {
        name = d.booked_by || (d.room_number ? `Guest (Room ${d.room_number})` : 'Guest')
        role = 'GUEST'
      } else if (role === 'STAFF' || role === 'FRONT_DESK') {
        name = 'Staff Member'
      }
    } else if (role === 'STAFF' && name.startsWith('Guest')) {
      // Guard against guest strings accidentally mapped to STAFF role in logs
      name = 'Front Desk Staff'
    }

    const email = d.actor_email || null
    return { name, role, email }
  }

  // ─── Detail Modal ────────────────────────────────────────────────────────────

  const renderDetailModal = () => {
    if (!selectedRequest) return null
    const req = selectedRequest
    const p = req.payload as any
    const st = getStatusStyle(req.status)
    const icon = getTypeIcon(req.request_type)
    const roomNames = req.request_type === 'FUNCTION_ROOM_BOOKING'
      ? (p?.room_names || p?.room_name || (Array.isArray(p?.function_room_ids) ? p.function_room_ids.map((id: string) => id).join(', ') : 'Function room'))
      : (req.rooms?.room_number || p?.room_number || 'N/A')
    const { name: actorName, role: actorRole } = resolveActorFromRequest(req)

    return (
      <Modal
        visible={!!selectedRequest}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedRequest(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailCard}>

            {/* Header */}
            <View style={styles.detailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTitle}>
                  {icon} {getTypeSummary(req)}
                </Text>
                <Text style={styles.detailSub}>{req.request_type === 'FUNCTION_ROOM_BOOKING' ? roomNames : `Room ${roomNames}`} · {formatRelativeTime(req.created_at)}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedRequest(null)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.detailScroll}>

              {/* Status badge */}
              <View style={[styles.statusBadgeLarge, { backgroundColor: st.bg }]}>
                <Text style={[styles.statusBadgeLargeText, { color: st.color }]}>{st.label}</Text>
              </View>

              {/* Core fields */}
              <View style={styles.detailSection}>
                {req.request_type === 'FUNCTION_ROOM_BOOKING' ? (
                  <>
                    <DetailRow label="Function Rooms" value={roomNames} />
                    <DetailRow label="Booker" value={p?.booker_name || '—'} />
                    <DetailRow label="Phone" value={p?.phone_number || 'Not provided'} />
                    <DetailRow label="Date" value={p?.booking_date ? `${new Date(`${p.booking_date}T12:00:00`).toLocaleDateString()}${p?.booking_date_end && p.booking_date_end !== p.booking_date ? ` – ${new Date(`${p.booking_date_end}T12:00:00`).toLocaleDateString()}` : ''}` : '—'} />
                    <DetailRow label="Time" value={`${p?.start_time || '—'} - ${p?.end_time || '—'}`} />
                    <DetailRow label="Food Budget" value={p?.food_budget ? `₱${Number(p.food_budget).toLocaleString()}` : '₱0'} />
                    <DetailRow label="Banquet Notes" value={p?.banquet_food_notes || 'None'} />
                    <DetailRow label="Equipment Rental" value={Array.isArray(p?.rented_equipments) && p.rented_equipments.length ? p.rented_equipments.map((item: any) => `${item.name} (${item.quantity ? `x${item.quantity}` : ''} ₱${Number(item.rental_price || 0).toLocaleString()})`).join(', ') : 'None'} />
                    <DetailRow label="Notes" value={p?.notes || 'None'} />
                    <DetailRow label="Total Amount" value={p?.total_amount ? `₱${Number(p.total_amount).toLocaleString()}` : '₱0'} />
                  </>
                ) : (
                  <DetailRow label="Room" value={`Room ${roomNames}`} />
                )}
                <DetailRow label="Request Type" value={req.request_type.replace(/_/g, ' ')} />
                <DetailRow label="Submitted" value={new Date(req.created_at).toLocaleString()} />

                {req.request_type === 'FOOD_ORDER' && p?.items && (() => {
                  const itemsSum = p.items.reduce((s: number, it: any) => s + (Number(it.unit_price || 0) * Number(it.quantity || 1)), 0)
                  const subtotal = p.subtotal !== undefined ? Number(p.subtotal) : itemsSum
                  const scAmt = p.service_charge_amount !== undefined ? Number(p.service_charge_amount) : (Number(p.total_price || 0) > subtotal ? Number(p.total_price) - subtotal : 0)
                  const grandTotal = Number(p.total_price || (subtotal + scAmt))

                  return (
                    <View style={styles.detailRowBlock}>
                      <Text style={styles.detailLabel}>Items</Text>
                      <View style={styles.itemsList}>
                        {p.items.map((item: any, i: number) => (
                          <Text key={i} style={styles.itemRow}>
                            • {item.quantity}× {item.name} — ₱{(Number(item.unit_price || 0) * Number(item.quantity || 1)).toLocaleString()}
                          </Text>
                        ))}
                      </View>

                      {/* Price Breakdown */}
                      <View style={{ marginTop: 8, gap: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Items Subtotal</Text>
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                            ₱{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>

                        {scAmt > 0 && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: '#fbbf24', fontSize: 13, fontWeight: '600' }}>
                              💳 Service Charge ({p.service_charge_pct || 10}%)
                            </Text>
                            <Text style={{ color: '#fbbf24', fontSize: 13, fontWeight: '700' }}>
                              +₱{scAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          </View>
                        )}

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 6 }}>
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>Grand Total</Text>
                          <Text style={{ color: '#f97316', fontSize: 16, fontWeight: '900' }}>
                            ₱{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )
                })()}

                {req.request_type === 'SPA_BOOKING' && <>
                  <DetailRow label="Service" value={p?.service_name || '—'} />
                  <DetailRow label="Slot Time" value={p?.slot_time || p?.display_time || '—'} />
                  <DetailRow label="Duration" value={p?.duration_mins ? `${p.duration_mins} min` : '—'} />
                  <DetailRow label="Price" value={p?.price ? `₱${Number(p.price).toLocaleString()}` : '—'} />
                  {p?.therapist_name && <DetailRow label="Therapist" value={p.therapist_name} />}
                  {p?.intake_note && <DetailRow label="Notes" value={p.intake_note} />}
                </>}

                {req.request_type === 'TASK' && <>
                  <DetailRow label="Task Name" value={p?.task_name || 'Room Request'} />
                  {p?.target_department && <DetailRow label="Department" value={p.target_department.replace(/_/g, ' ')} />}
                  {p?.priority && <DetailRow label="Priority" value={p.priority} />}
                  {(p?.quantity ?? 1) > 1 && <DetailRow label="Quantity" value={`× ${p.quantity}`} />}
                  {p?.custom_notes && <DetailRow label="Notes" value={p.custom_notes.replace(/\[Guest Phone:\s*[^\]]+\]/, '').trim() || p.custom_notes} />}
                </>}

                {req.request_type === 'CALL_REQUEST' && <>
                  {p?.note && <DetailRow label="Guest Note" value={p.note} />}
                </>}

                {/* Universal Guest Phone Dialing Row in Detail Modal */}
                {(() => {
                  const notesPhone = typeof p?.custom_notes === 'string'
                    ? (p.custom_notes.match(/\[Guest Phone:\s*([^\]]+)\]/)?.[1]?.trim() || p.custom_notes.match(/\+?\d[\d\s-]{6,15}\d/)?.[0]?.trim())
                    : null
                  const instructionsPhone = typeof p?.special_instructions === 'string'
                    ? p.special_instructions.match(/\+?\d[\d\s-]{6,15}\d/)?.[0]?.trim()
                    : null
                  const phone = p?.guest_phone || p?.phone_number || p?.phone || notesPhone || instructionsPhone || null

                  if (phone) {
                    return (
                      <View style={styles.callPhoneRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailLabel}>Guest Phone</Text>
                          <Text style={styles.callPhoneNumber}>{phone}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.callPhoneBtn}
                          onPress={() => {
                            Linking.openURL(`tel:${phone}`).catch(() =>
                              Alert.alert('Cannot Open Dialer', 'Unable to open the phone dialer on this device.')
                            )
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.callPhoneBtnText}>📞 Dial Now</Text>
                        </TouchableOpacity>
                      </View>
                    )
                  }
                  return <DetailRow label="Guest Phone" value="No number provided" />
                })()}

                {p?.special_instructions && req.request_type !== 'SPA_BOOKING' && req.request_type !== 'TASK' && (
                  <DetailRow label="Special Instructions" value={p.special_instructions} />
                )}
              </View>

              {/* Performed By */}
              {actorName && (
                <View style={styles.actorBox}>
                  <Text style={styles.actorBoxLabel}>Handled / Booked By</Text>
                  <View style={styles.actorRow}>
                    <Text style={styles.actorIcon}>{actorRole === 'GUEST' ? '📱' : '🧑‍💼'}</Text>
                    <View>
                      <Text style={[styles.actorName, { color: actorRole === 'GUEST' ? '#38bdf8' : '#a78bfa' }]}>
                        {actorName}
                      </Text>
                      {actorRole && (
                        <Text style={styles.actorRole}>{actorRole.replace(/_/g, ' ')}</Text>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {/* Audit Trail */}
              <View style={styles.timelineSection}>
                <Text style={styles.timelineHeader}>📜 Audit Trail Timeline</Text>
                {loadingAudit ? (
                  <ActivityIndicator size="small" color="#a78bfa" style={{ marginVertical: 12 }} />
                ) : auditTrail.length === 0 ? (
                  <View style={styles.timelineEmpty}>
                    <Text style={styles.timelineEmptyText}>No audit logs recorded for this request.</Text>
                  </View>
                ) : (
                  <View style={styles.timelineList}>
                    {auditTrail.map((log, idx) => {
                      const isLast = idx === auditTrail.length - 1
                      const { name: tlActor, role: tlRole, email: tlEmail } = resolveActorFromLog(log)
                      const d = log.details || {}
                      return (
                        <View key={log.id || idx} style={styles.timelineItem}>
                          <View style={styles.timelineLeft}>
                            <View style={styles.timelineDot} />
                            {!isLast && <View style={styles.timelineLine} />}
                          </View>
                          <View style={styles.timelineRight}>
                            <View style={styles.timelineTitleRow}>
                              <Text style={styles.timelineAction}>{log.action.replace(/_/g, ' ')}</Text>
                              <Text style={styles.timelineTime}>
                                {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </Text>
                            </View>
                            <Text style={styles.timelineDate}>
                              {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Text>
                            {tlActor && (
                              <Text style={[styles.timelineActor, { color: tlRole === 'GUEST' ? '#38bdf8' : '#a78bfa' }]}>
                                {tlRole === 'GUEST' ? '📱' : '🧑‍💼'} {tlActor}
                                {tlRole && tlRole !== 'GUEST' ? ` · ${tlRole.replace(/_/g, ' ')}` : ''}
                              </Text>
                            )}
                            {tlEmail && (
                              <Text style={styles.timelineEmail}>{tlEmail}</Text>
                            )}
                            {d.summary ? (
                              <Text style={styles.timelineDetails}>📌 {d.summary}</Text>
                            ) : d.new_total !== undefined ? (
                              <Text style={styles.timelineDetails}>
                                📝 Order Updated: ₱{Number(d.new_total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                {d.service_charge_amount ? ` (incl. ₱${Number(d.service_charge_amount).toFixed(2)} service charge)` : ''}
                              </Text>
                            ) : d.rejection_reason ? (
                              <Text style={styles.timelineDetails}>Reason: {d.rejection_reason}</Text>
                            ) : d.source ? (
                              <Text style={styles.timelineDetails}>Source: {d.source.replace(/_/g, ' ')}</Text>
                            ) : null}
                          </View>
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>

            </ScrollView>

            <TouchableOpacity style={styles.closeBarBtn} onPress={() => setSelectedRequest(null)}>
              <Text style={styles.closeBarBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'ALL', label: `All (${requests.length})` },
    { key: 'FOOD_ORDER', label: '🍽️ Food' },
    { key: 'SPA_BOOKING', label: '💆 Spa' },
    { key: 'CALL_REQUEST', label: '📞 Calls' },
    { key: 'TASK', label: '🧹 Tasks' },
    { key: 'FUNCTION_ROOM_BOOKING' as FilterType, label: '🏛️ Function Rooms' },
  ]

  return (
    <View style={styles.container}>

      {/* ─── Accordion Header (always visible) ─── */}
      <TouchableOpacity
        style={styles.accordionHeader}
        activeOpacity={0.7}
        onPress={() => setIsAccordionOpen(prev => !prev)}
      >
        <View style={styles.accordionTitleGroup}>
          <Text style={styles.accordionIcon}>📜</Text>
          <Text style={styles.accordionTitle}>Request History & Logs</Text>
          {requests.length > 0 && (
            <View style={styles.accordionBadge}>
              <Text style={styles.accordionBadgeText}>{requests.length}</Text>
            </View>
          )}
        </View>
        <Text style={styles.accordionChevron}>
          {isAccordionOpen ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {/* ─── Collapsible Body ─── */}
      {isAccordionOpen && (
        <View style={styles.accordionBody}>

          <View style={styles.header}>
            <View style={styles.titleRow}>
              {sortedRequests.length > 5 && (
                <TouchableOpacity
                  style={styles.expandToggleBtn}
                  onPress={() => setIsExpanded(prev => !prev)}
                >
                  <Text style={styles.expandToggleText}>
                    {isExpanded ? '▲ Minimize' : `▼ Expand (${sortedRequests.length})`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Type Filter Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.filterRow}>
                {filterTabs.map(tab => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.filterTab, typeFilter === tab.key && styles.filterTabActive]}
                    onPress={() => setTypeFilter(tab.key)}
                  >
                    <Text style={[styles.filterTabText, typeFilter === tab.key && styles.filterTabTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Sorting Controls */}
            <View style={styles.sortBar}>
              <TouchableOpacity
                style={[styles.sortBtn, activeSortType === 'ROOM' && styles.sortBtnActive]}
                onPress={() => {
                  if (activeSortType === 'ROOM') {
                    setRoomSort(prev => prev === 'asc' ? 'desc' : 'asc')
                  } else {
                    setActiveSortType('ROOM')
                  }
                }}
              >
                <Text style={[styles.sortText, activeSortType === 'ROOM' && styles.sortTextActive]}>
                  🚪 Room {activeSortType === 'ROOM' ? (roomSort === 'asc' ? '↑' : '↓') : ''}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sortBtn, activeSortType === 'DATE' && styles.sortBtnActive]}
                onPress={() => {
                  if (activeSortType === 'DATE') {
                    setDateSort(prev => prev === 'desc' ? 'asc' : 'desc')
                  } else {
                    setActiveSortType('DATE')
                  }
                }}
              >
                <Text style={[styles.sortText, activeSortType === 'DATE' && styles.sortTextActive]}>
                  ⏱ Date {activeSortType === 'DATE' ? (dateSort === 'desc' ? '↓ Newest' : '↑ Oldest') : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color="#fbbf24" style={{ marginVertical: 20 }} />
          ) : sortedRequests.length === 0 ? (
            <Text style={styles.emptyText}>No historical logs available.</Text>
          ) : (
            <FlatList
              data={displayedRequests}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
              scrollEnabled={false}

              renderItem={({ item }) => {
                const st = getStatusStyle(item.status)
                const icon = getTypeIcon(item.request_type)
                const roomDisplay = item.request_type === 'FUNCTION_ROOM_BOOKING'
                  ? ((item.payload as any)?.room_names || (item.payload as any)?.room_name || 'Function room')
                  : (item.rooms?.room_number || (item.payload as any)?.room_number || 'N/A')
                const dateStr = formatRelativeTime(item.created_at)
                const { name: actorName, role: actorRole } = resolveActorFromRequest(item)

                return (
                  <TouchableOpacity
                    style={styles.card}
                    activeOpacity={0.75}
                    onPress={() => handleSelectRequest(item)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.roomTag}>
                        <Text style={styles.iconText}>{icon}</Text>
                        <Text style={styles.roomNo}>{item.request_type === 'FUNCTION_ROOM_BOOKING' ? roomDisplay : `Room ${roomDisplay}`}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>

                    <Text style={styles.summaryText}>{getTypeSummary(item)}</Text>

                    {/* Universal quick-call row — shown on ALL request types */}
                    {(() => {
                      const p = item.payload as any
                      // Check dedicated fields first, then parse legacy "[Guest Phone: xxx]" or phone patterns from custom_notes / special_instructions
                      const notesPhone = typeof p?.custom_notes === 'string'
                        ? (p.custom_notes.match(/\[Guest Phone:\s*([^\]]+)\]/)?.[1]?.trim() || p.custom_notes.match(/\+?\d[\d\s-]{6,15}\d/)?.[0]?.trim())
                        : null
                      const instructionsPhone = typeof p?.special_instructions === 'string'
                        ? p.special_instructions.match(/\+?\d[\d\s-]{6,15}\d/)?.[0]?.trim()
                        : null
                      const phone = p?.guest_phone || p?.phone_number || p?.phone || notesPhone || instructionsPhone || null
                      if (phone) {
                        return (
                          <TouchableOpacity
                            style={styles.callHistoryPhoneRow}
                            activeOpacity={0.7}
                            onPress={() =>
                              Linking.openURL(`tel:${phone}`).catch(() =>
                                Alert.alert('Cannot Open Dialer', 'Unable to open the phone dialer on this device.')
                              )
                            }
                          >
                            <Text style={styles.callHistoryPhoneText}>📞 {phone}</Text>
                            <Text style={styles.callHistoryPhoneHint}>Tap to call</Text>
                          </TouchableOpacity>
                        )
                      }
                      // Show a muted "no phone" chip so staff know it's not missing by accident
                      return (
                        <View style={styles.callHistoryNoPhoneChip}>
                          <Text style={styles.callHistoryNoPhone}>📞 No phone on file</Text>
                        </View>
                      )
                    })()}

                    {/* Actor attribution */}
                    {actorName && (
                      <View style={styles.actorChip}>
                        <Text style={[styles.actorChipText, { color: actorRole === 'GUEST' ? '#38bdf8' : '#a78bfa' }]}>
                          {actorRole === 'GUEST' ? '📱' : '🧑‍💼'} {actorName}
                          {actorRole && actorRole !== 'GUEST' ? ` · ${actorRole.replace(/_/g, ' ')}` : ''}
                        </Text>
                      </View>
                    )}

                    <View style={styles.metaRow}>
                      <Text style={styles.metaTime}>🕒 {dateStr}</Text>
                      <Text style={styles.tapHint}>Tap for details →</Text>
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
          )}

        </View>
      )}

      {renderDetailModal()}
    </View>
  )
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: 20,
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  accordionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  accordionIcon: {
    fontSize: 16,
  },
  accordionTitle: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  accordionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  accordionBadgeText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
  },
  accordionChevron: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 8,
  },
  accordionBody: {
    marginTop: 14,
  },
  header: {
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heading: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  expandToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  expandToggleText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },

  // Filter tabs
  filterScroll: {
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterTabActive: {
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderColor: '#38bdf8',
  },
  filterTabText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },

  // Sort bar
  sortBar: {
    flexDirection: 'row',
    gap: 8,
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sortBtnActive: {
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderColor: '#38bdf8',
  },
  sortText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  sortTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },

  emptyText: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Cards
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  roomTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconText: {
    fontSize: 16,
  },
  roomNo: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  summaryText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  actorChip: {
    marginBottom: 6,
  },
  actorChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 6,
    alignItems: 'center',
  },
  metaTime: {
    color: '#64748b',
    fontSize: 10,
  },
  tapHint: {
    color: '#334155',
    fontSize: 10,
    fontStyle: 'italic',
  },

  // ─── Detail Modal ─────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.2)',
    height: '88%',
    maxHeight: '88%',
    flexDirection: 'column',
    paddingBottom: 20,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  detailTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 2,
  },
  detailSub: {
    color: '#64748b',
    fontSize: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  detailScroll: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  statusBadgeLarge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 16,
  },
  statusBadgeLargeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  detailSection: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    gap: 8,
  },
  detailRowBlock: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  detailLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 100,
  },
  detailValue: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  itemsList: {
    marginTop: 4,
    marginBottom: 4,
  },
  itemRow: {
    color: '#cbd5e1',
    fontSize: 12,
    paddingVertical: 2,
  },

  // Actor box
  actorBox: {
    backgroundColor: 'rgba(167,139,250,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.2)',
  },
  actorBoxLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actorIcon: {
    fontSize: 20,
  },
  actorName: {
    fontSize: 14,
    fontWeight: '800',
  },
  actorRole: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 1,
  },

  // Timeline
  timelineSection: {
    marginBottom: 20,
  },
  timelineHeader: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  timelineEmpty: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  timelineEmptyText: {
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
  },
  timelineList: {
    paddingLeft: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 14,
    marginTop: 4,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#38bdf8',
    borderWidth: 2,
    borderColor: '#0f172a',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: 'rgba(56,189,248,0.2)',
    marginTop: 2,
    marginBottom: 2,
    minHeight: 24,
  },
  timelineRight: {
    flex: 1,
    paddingBottom: 14,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineAction: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  timelineTime: {
    color: '#64748b',
    fontSize: 11,
  },
  timelineDate: {
    color: '#475569',
    fontSize: 10,
    marginTop: 1,
    marginBottom: 3,
  },
  timelineActor: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  timelineEmail: {
    color: '#475569',
    fontSize: 10,
    marginBottom: 2,
  },
  timelineDetails: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
  },

  // Close bar
  closeBarBtn: {
    marginHorizontal: 18,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.3)',
    alignItems: 'center',
  },
  closeBarBtnText: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 14,
  },

  // ── Call request history card phone row ──────────────────────────
  callHistoryPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(52,211,153,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  callHistoryPhoneText: {
    color: '#34d399',
    fontWeight: '700',
    fontSize: 13,
  },
  callHistoryPhoneHint: {
    color: '#34d399',
    fontSize: 10,
    opacity: 0.7,
  },
  callHistoryNoPhone: {
    color: '#475569',
    fontSize: 12,
    fontStyle: 'italic',
  },
  callHistoryNoPhoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 6,
    marginBottom: 4,
  },

  // ── Call request detail modal phone row ──────────────────────────
  callPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  callPhoneNumber: {
    color: '#34d399',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  callPhoneBtn: {
    backgroundColor: 'rgba(52,211,153,0.2)',
    borderWidth: 1,
    borderColor: '#34d399',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  callPhoneBtnText: {
    color: '#34d399',
    fontWeight: '800',
    fontSize: 13,
  },
})

