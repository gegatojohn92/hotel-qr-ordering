import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../lib/supabase'

const HOTEL_ID = '00000000-0000-0000-0000-000000000001'

type RoomStatus = 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'COMPLETED'

type FunctionRoom = {
  id: string
  hotel_id: string
  name: string
  capacity: number
  is_active: boolean
  created_at: string
}

type FunctionRoomEquipment = {
  id: string
  hotel_id: string
  name: string
  rental_price: number
  is_active: boolean
  created_at: string
}

type BookingEquipmentEntry = {
  id: string
  name: string
  rental_price: number
}

type FunctionRoomBooking = {
  id: string
  function_room_id: string
  function_room_ids?: string[]
  room_names?: string | null
  booker_name: string
  phone_number: string | null
  booking_date: string
  booking_date_end: string
  start_time: string
  end_time: string
  food_budget: number
  banquet_food_notes: string | null
  rented_equipments: BookingEquipmentEntry[]
  downpayment_amount: number
  total_amount: number
  notes: string | null
  status: RoomStatus
  created_by_staff_id: string | null
  created_at: string
}

type BookingFormState = {
  function_room_id: string
  selectedRoomIds: string[]
  booker_name: string
  phone_number: string
  booking_date: string
  booking_date_end: string
  start_time: string
  end_time: string
  food_budget: string
  banquet_food_notes: string
  notes: string
  selectedEquipmentIds: string[]
  downpayment_amount: string
  status: RoomStatus
}

const DEFAULT_FORM: BookingFormState = {
  function_room_id: '',
  selectedRoomIds: [],
  booker_name: '',
  phone_number: '',
  booking_date: new Date().toISOString().slice(0, 10),
  booking_date_end: new Date().toISOString().slice(0, 10),
  start_time: '09:00',
  end_time: '11:00',
  food_budget: '0',
  banquet_food_notes: '',
  notes: '',
  selectedEquipmentIds: [],
  downpayment_amount: '0',
  status: 'PENDING',
}

function parseNumber(v: string | number | undefined) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value)
}

function formatDateLabel(date: string) {
  if (!date) return 'Select date'
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function FunctionRoomModule({ activeStaffUser }: { activeStaffUser?: { id?: string; role?: string; full_name?: string } | null }) {
  const [rooms, setRooms] = useState<FunctionRoom[]>([])
  const [equipment, setEquipment] = useState<FunctionRoomEquipment[]>([])
  const [bookings, setBookings] = useState<FunctionRoomBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [form, setForm] = useState<BookingFormState>(DEFAULT_FORM)
  const [error, setError] = useState('')

  const equipmentMap = useMemo(() => {
    return new Map(equipment.map((item) => [item.id, item]))
  }, [equipment])

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === form.function_room_id) || null,
    [form.function_room_id, rooms]
  )

  const equipmentTotal = useMemo(() => {
    return form.selectedEquipmentIds.reduce((sum, itemId) => {
      const item = equipmentMap.get(itemId)
      return sum + (item ? Number(item.rental_price) : 0)
    }, 0)
  }, [equipmentMap, form.selectedEquipmentIds])

  const totalBookingValue = useMemo(() => {
    return parseNumber(form.food_budget) + equipmentTotal
  }, [equipmentTotal, form.food_budget])

  const upcomingBookings = useMemo(() => {
    return [...bookings]
      .filter((booking) => !['CANCELLED'].includes(booking.status))
      .sort((a, b) => {
        const aDate = new Date(`${a.booking_date}T${a.start_time}`).getTime()
        const bDate = new Date(`${b.booking_date}T${b.start_time}`).getTime()
        return aDate - bDate
      })
  }, [bookings])

  const loadData = async () => {
    setLoading(true)
    try {
      const [roomsRes, equipmentRes, bookingRes] = await Promise.all([
        supabase.from('function_rooms').select('*').eq('hotel_id', HOTEL_ID).eq('is_active', true).order('name', { ascending: true }),
        supabase.from('function_room_equipments').select('*').eq('hotel_id', HOTEL_ID).eq('is_active', true).order('name', { ascending: true }),
        supabase.from('function_room_bookings').select('*').eq('hotel_id', HOTEL_ID).order('booking_date', { ascending: true }).order('start_time', { ascending: true }),
      ])

      if (roomsRes.data) setRooms((roomsRes.data as FunctionRoom[]) || [])
      if (equipmentRes.data) setEquipment((equipmentRes.data as FunctionRoomEquipment[]) || [])
      if (bookingRes.data) setBookings((bookingRes.data as FunctionRoomBooking[]) || [])

      if ((!form.function_room_id || form.selectedRoomIds.length === 0) && roomsRes.data && roomsRes.data.length > 0) {
        const firstRoomId = roomsRes.data[0].id
        setForm((prev) => ({
          ...prev,
          function_room_id: firstRoomId,
          selectedRoomIds: prev.selectedRoomIds.length ? prev.selectedRoomIds : [firstRoomId],
        }))
      }
    } catch (err) {
      console.warn('[FunctionRoomModule] loadData error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('function-room-bookings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'function_room_bookings' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'function_rooms' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'function_room_equipments' }, () => loadData())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const hasBookingOverlap = (roomId: string, dateStart: string, dateEnd: string, start: string, end: string, ignoreId?: string) => {
    return bookings.some((booking) => {
      const roomIds = booking.function_room_ids && booking.function_room_ids.length > 0 ? booking.function_room_ids : [booking.function_room_id]
      if (!roomIds.includes(roomId)) return false
      if (ignoreId && booking.id === ignoreId) return false
      if (!['PENDING', 'CONFIRMED'].includes(booking.status)) return false
      // Date range overlap: new range overlaps existing if new start <= existing end AND new end >= existing start
      const bookingEnd = booking.booking_date_end || booking.booking_date
      if (dateStart > bookingEnd || dateEnd < booking.booking_date) return false
      // Time slot overlap within the overlapping days
      return start < booking.end_time && end > booking.start_time
    })
  }

  const roomNameSummary = (roomIds: string[]) => {
    const names = roomIds
      .map((roomId) => roomNameMap.get(roomId))
      .filter(Boolean) as string[]

    return names.join(', ') || 'Function room'
  }

  const handleSubmit = async () => {
    setError('')

    const selectedRoomIds = form.selectedRoomIds.length > 0 ? form.selectedRoomIds : [form.function_room_id]

    if (!selectedRoomIds.length || !form.booker_name.trim() || !form.booking_date || !form.booking_date_end || !form.start_time || !form.end_time) {
      setError('Please complete all required booking fields.')
      return
    }

    if (form.booking_date_end < form.booking_date) {
      setError('End date must be on or after the start date.')
      return
    }

    if (form.start_time >= form.end_time) {
      setError('End time must be later than the start time.')
      return
    }

    const selectedEquipment = form.selectedEquipmentIds
      .map((id) => equipmentMap.get(id))
      .filter(Boolean)
      .map((item) => ({
        id: item!.id,
        name: item!.name,
        rental_price: Number(item!.rental_price),
      }))

    const bookingPayload = {
      hotel_id: HOTEL_ID,
      function_room_id: selectedRoomIds[0],
      function_room_ids: selectedRoomIds,
      room_names: roomNameSummary(selectedRoomIds),
      booker_name: form.booker_name.trim(),
      phone_number: form.phone_number.trim() || null,
      booking_date: form.booking_date,
      booking_date_end: form.booking_date_end,
      start_time: form.start_time,
      end_time: form.end_time,
      food_budget: parseNumber(form.food_budget),
      banquet_food_notes: form.banquet_food_notes.trim() || null,
      rented_equipments: selectedEquipment,
      downpayment_amount: parseNumber(form.downpayment_amount),
      total_amount: parseNumber(form.food_budget) + equipmentTotal,
      notes: form.notes.trim() || null,
      status: form.status,
      created_by_staff_id: activeStaffUser?.id || null,
    }

    const guestRoomLookup = await supabase
      .from('rooms')
      .select('id')
      .eq('hotel_id', HOTEL_ID)
      .limit(1)
      .maybeSingle()

    const fallbackRoomId = guestRoomLookup.data?.id || '00000000-0000-0000-0000-000000000101'

    setSaving(true)
    try {
      if (editingBookingId) {
        const { error: updateError } = await supabase
          .from('function_room_bookings')
          .update({
            ...bookingPayload,
            function_room_id: selectedRoomIds[0],
            function_room_ids: selectedRoomIds,
            room_names: roomNameSummary(selectedRoomIds),
          })
          .eq('id', editingBookingId)

        if (updateError) throw updateError

        const { data: relatedRequests } = await supabase
          .from('requests')
          .select('*')
          .eq('hotel_id', HOTEL_ID)
          .eq('request_type', 'FUNCTION_ROOM_BOOKING')

        const matchingRequests = (relatedRequests || []).filter((request: any) => request.payload?.function_room_booking_id === editingBookingId)
        for (const request of matchingRequests) {
          const nextPayload = {
            ...(request.payload || {}),
            function_room_booking_id: editingBookingId,
            booker_name: form.booker_name.trim(),
            phone_number: form.phone_number.trim() || null,
            booking_date: form.booking_date,
            booking_date_end: form.booking_date_end,
            start_time: form.start_time,
            end_time: form.end_time,
            room_name: roomNameSummary(selectedRoomIds),
            room_names: roomNameSummary(selectedRoomIds),
            function_room_id: selectedRoomIds[0],
            function_room_ids: selectedRoomIds,
            food_budget: parseNumber(form.food_budget),
            banquet_food_notes: form.banquet_food_notes.trim() || null,
            total_amount: parseNumber(form.food_budget) + equipmentTotal,
            notes: form.notes.trim() || null,
            rented_equipments: selectedEquipment,
            status: form.status,
          }

          const { error: requestUpdateError } = await supabase
            .from('requests')
            .update({
              status: form.status,
              payload: nextPayload,
            })
            .eq('id', request.id)

          if (requestUpdateError) {
            console.warn('[FunctionRoomModule] request update warning:', requestUpdateError)
          }
        }

        await (supabase.from('audit_logs') as any).insert([{
          hotel_id: HOTEL_ID,
          request_id: matchingRequests[0]?.id || null,
          action: 'FUNCTION_ROOM_BOOKING_UPDATED',
          actor_id: activeStaffUser?.id || null,
          details: {
            actor_name: activeStaffUser?.full_name || 'Staff Member',
            actor_role: activeStaffUser?.role || 'STAFF',
            booking_id: editingBookingId,
            room_names: roomNameSummary(selectedRoomIds),
            room_name: roomNameSummary(selectedRoomIds),
            booker_name: form.booker_name.trim(),
            booking_date: form.booking_date,
            booking_date_end: form.booking_date_end,
            start_time: form.start_time,
            end_time: form.end_time,
            food_budget: parseNumber(form.food_budget),
            banquet_food_notes: form.banquet_food_notes.trim() || null,
            rented_equipments: selectedEquipment,
            notes: form.notes.trim() || null,
            updated_fields: ['booker_name', 'schedule', 'equipment', 'notes'],
            timestamp: new Date().toISOString(),
          },
        }])

        Alert.alert('Booking updated', 'The function room booking was updated successfully.')
      } else {
        for (const roomId of selectedRoomIds) {
          if (hasBookingOverlap(roomId, form.booking_date, form.booking_date_end, form.start_time, form.end_time)) {
            setError('One or more selected rooms already have a booking in the chosen date range and time slot.')
            return
          }
        }

        const { data: insertedBookings, error: insertError } = await supabase
          .from('function_room_bookings')
          .insert([{
            ...bookingPayload,
            hotel_id: HOTEL_ID,
            function_room_id: selectedRoomIds[0],
            function_room_ids: selectedRoomIds,
            room_names: roomNameSummary(selectedRoomIds),
          }])
          .select()

        if (insertError) {
          throw insertError
        }

        const requestRows = (insertedBookings || []).map((row: any) => ({
          hotel_id: HOTEL_ID,
          room_id: fallbackRoomId,
          request_type: 'FUNCTION_ROOM_BOOKING',
          status: row.status,
          payload: {
            function_room_booking_id: row.id,
            booker_name: row.booker_name,
            phone_number: row.phone_number,
            booking_date: row.booking_date,
            booking_date_end: row.booking_date_end || row.booking_date,
            start_time: row.start_time,
            end_time: row.end_time,
            room_name: row.room_names || roomNameSummary(row.function_room_ids || [row.function_room_id]),
            room_names: row.room_names || roomNameSummary(row.function_room_ids || [row.function_room_id]),
            function_room_id: row.function_room_id,
            function_room_ids: row.function_room_ids || [row.function_room_id],
            food_budget: row.food_budget,
            banquet_food_notes: row.banquet_food_notes,
            total_amount: row.total_amount,
            notes: row.notes,
            rented_equipments: row.rented_equipments || [],
            status: row.status,
            created_by_staff_id: row.created_by_staff_id,
          },
          claimed_by: activeStaffUser?.id || null,
          claimed_at: row.status === 'CONFIRMED' ? new Date().toISOString() : null,
        }))

        if (requestRows.length > 0) {
          const { error: requestInsertError } = await supabase.from('requests').insert(requestRows)
          if (requestInsertError) {
            console.warn('[FunctionRoomModule] request audit row insert warning:', requestInsertError)
          }
        }

        try {
          const { data: historyRequests } = await supabase
            .from('requests')
            .select('*')
            .eq('hotel_id', HOTEL_ID)
            .eq('request_type', 'FUNCTION_ROOM_BOOKING')

          const logRows = (insertedBookings || []).flatMap((row: any) => {
            const matchedRequest = (historyRequests || []).find((req: any) => req.payload?.function_room_booking_id === row.id)
            return matchedRequest ? [{
              hotel_id: HOTEL_ID,
              request_id: matchedRequest.id,
              action: 'FUNCTION_ROOM_BOOKING_CREATED',
              actor_id: activeStaffUser?.id || null,
              details: {
                actor_name: activeStaffUser?.full_name || 'Staff Member',
                actor_role: activeStaffUser?.role || 'STAFF',
                booker_name: row.booker_name,
                room_name: row.room_names || roomNameSummary(row.function_room_ids || [row.function_room_id]),
                room_names: row.room_names || roomNameSummary(row.function_room_ids || [row.function_room_id]),
                booking_date: row.booking_date,
                booking_date_end: row.booking_date_end || row.booking_date,
                start_time: row.start_time,
                end_time: row.end_time,
                food_budget: row.food_budget,
                banquet_food_notes: row.banquet_food_notes,
                rented_equipments: row.rented_equipments || [],
                notes: row.notes,
                new_status: row.status,
                timestamp: new Date().toISOString(),
              },
            }] : []
          })

          if (logRows.length > 0) {
            await (supabase.from('audit_logs') as any).insert(logRows)
          }
        } catch (auditErr) {
          console.warn('[FunctionRoomModule] Non-fatal booking audit log error:', auditErr)
        }

        Alert.alert('Function room booking saved', selectedRoomIds.length > 1 ? 'All selected rooms were booked successfully.' : 'The booking has been created successfully.')
      }

      closeModal()
      await loadData()
    } catch (err: any) {
      setError(err?.message || 'Unable to save booking.')
    } finally {
      setSaving(false)
    }
  }

  const openCreateModal = () => {
    setEditingBookingId(null)
    setError('')
    setVisible(true)
    setForm({
      ...DEFAULT_FORM,
      function_room_id: rooms[0]?.id || '',
      selectedRoomIds: rooms[0] ? [rooms[0].id] : [],
    })
  }

  const openEditModal = (booking: FunctionRoomBooking) => {
    setEditingBookingId(booking.id)
    setError('')
    setVisible(true)
    setForm({
      function_room_id: booking.function_room_id,
      selectedRoomIds: booking.function_room_ids && booking.function_room_ids.length > 0 ? booking.function_room_ids : [booking.function_room_id],
      booker_name: booking.booker_name,
      phone_number: booking.phone_number || '',
      booking_date: booking.booking_date,
      booking_date_end: booking.booking_date_end || booking.booking_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      food_budget: String(booking.food_budget ?? 0),
      banquet_food_notes: booking.banquet_food_notes || '',
      notes: booking.notes || '',
      selectedEquipmentIds: booking.rented_equipments?.map((item) => item.id) || [],
      downpayment_amount: String(booking.downpayment_amount ?? 0),
      status: booking.status,
    })
  }

  const closeModal = () => {
    setVisible(false)
    setEditingBookingId(null)
    setError('')
    setForm({
      ...DEFAULT_FORM,
      function_room_id: rooms[0]?.id || '',
      selectedRoomIds: rooms[0] ? [rooms[0].id] : [],
    })
  }

  const callBooker = async (phone: string | null) => {
    if (!phone) {
      Alert.alert('No phone number', 'This booking does not contain a phone number.')
      return
    }

    try {
      await Linking.openURL(`tel:${phone}`)
    } catch (err) {
      console.warn('[FunctionRoomModule] tel error:', err)
      Alert.alert('Dialer Error', 'Unable to open the phone dialer for this booking.')
    }
  }

  const updateBookingStatus = async (bookingId: string, status: RoomStatus, cancellationReason?: string) => {
    const booking = bookings.find((item) => item.id === bookingId)
    const roomSummary = booking ? (booking.room_names || roomNameSummary(booking.function_room_ids && booking.function_room_ids.length ? booking.function_room_ids : [booking.function_room_id])) : 'Function room'
    const normalizedCancellationReason = (cancellationReason || '').trim()
    const nextNotes = status === 'CANCELLED'
      ? (booking?.notes && booking.notes.trim()
        ? `${booking.notes.trim()} | Cancelled: ${normalizedCancellationReason || 'No reason provided'}`
        : normalizedCancellationReason ? `Cancelled: ${normalizedCancellationReason}` : booking?.notes || 'Cancelled')
      : booking?.notes || null

    try {
      const { error } = await supabase
        .from('function_room_bookings')
        .update({
          status,
          notes: nextNotes,
        })
        .eq('id', bookingId)

      if (error) throw error

      const { data: relatedRequests } = await supabase
        .from('requests')
        .select('*')
        .eq('hotel_id', HOTEL_ID)
        .eq('request_type', 'FUNCTION_ROOM_BOOKING')

      const targetRequests = (relatedRequests || []).filter((request: any) => request.payload?.function_room_booking_id === bookingId)

      for (const request of targetRequests) {
        const nextPayload = {
          ...(request.payload || {}),
          status,
          notes: nextNotes,
          cancellation_reason: status === 'CANCELLED' ? (normalizedCancellationReason || 'No reason provided') : null,
          room_name: roomSummary,
          room_names: roomSummary,
        }

        const { error: requestUpdateError } = await supabase
          .from('requests')
          .update({ status, payload: nextPayload })
          .eq('id', request.id)

        if (requestUpdateError) {
          console.warn('[FunctionRoomModule] request status sync warning:', requestUpdateError)
        }
      }

      try {
        await (supabase.from('audit_logs') as any).insert([
          {
            hotel_id: HOTEL_ID,
            request_id: targetRequests[0]?.id || null,
            action: status === 'CANCELLED' ? 'FUNCTION_ROOM_BOOKING_CANCELLED' : 'FUNCTION_ROOM_BOOKING_STATUS_CHANGED',
            actor_id: activeStaffUser?.id || null,
            details: {
              actor_name: activeStaffUser?.full_name || 'Staff Member',
              actor_role: activeStaffUser?.role || 'STAFF',
              booking_id: bookingId,
              room_name: roomSummary,
              room_names: roomSummary,
              booker_name: booking?.booker_name || 'Guest',
              old_status: booking?.status || 'PENDING',
              new_status: status,
              cancellation_reason: status === 'CANCELLED' ? (normalizedCancellationReason || 'No reason provided') : null,
              notes: nextNotes,
              timestamp: new Date().toISOString(),
            },
          },
        ])
      } catch (auditErr) {
        console.warn('[FunctionRoomModule] Non-fatal booking status audit log error:', auditErr)
      }

      await loadData()
      Alert.alert('Booking updated', status === 'CANCELLED' ? `Booking cancelled${normalizedCancellationReason ? `: ${normalizedCancellationReason}` : ''}.` : `Booking marked as ${status}.`)
    } catch (err: any) {
      Alert.alert('Update failed', err?.message || 'Unable to update the booking status.')
    }
  }

  const roomNameMap = useMemo(() => new Map(rooms.map((room) => [room.id, room.name])), [rooms])
  const nextBooking = upcomingBookings[0] || null

  const renderFunctionBookingDetail = (payload: any) => {
    const roomNames = payload?.room_names || payload?.room_name || (Array.isArray(payload?.function_room_ids) && payload.function_room_ids.length ? payload.function_room_ids.map((id: string) => roomNameMap.get(id)).filter(Boolean).join(', ') : roomNameMap.get(payload?.function_room_id) || 'Function room')
    const equipList = Array.isArray(payload?.rented_equipments) && payload.rented_equipments.length
      ? payload.rented_equipments.map((item: any) => `${item.name}${item.quantity ? ` x${item.quantity}` : ''} — ${formatCurrency(Number(item.rental_price || 0))}`).join(', ')
      : 'None'

    return (
      <View style={styles.detailSection}>
        <Text style={styles.detailTitleText}>Function Room Booking</Text>
        <Text style={styles.detailRowText}>Booker: {payload?.booker_name || '—'}</Text>
        <Text style={styles.detailRowText}>Phone: {payload?.phone_number || 'Not provided'}</Text>
        <Text style={styles.detailRowText}>Rooms: {roomNames}</Text>
        <Text style={styles.detailRowText}>Date: {formatDateLabel(payload?.booking_date || '')}{(payload?.booking_date_end && payload.booking_date_end !== payload.booking_date) ? ` – ${formatDateLabel(payload.booking_date_end)}` : ''}</Text>
        <Text style={styles.detailRowText}>Time: {payload?.start_time || '—'} - {payload?.end_time || '—'}</Text>
        <Text style={styles.detailRowText}>Food budget: {formatCurrency(Number(payload?.food_budget || 0))}</Text>
        <Text style={styles.detailRowText}>Banquet notes: {payload?.banquet_food_notes || 'None'}</Text>
        <Text style={styles.detailRowText}>Equipment rental: {equipList}</Text>
        <Text style={styles.detailRowText}>Notes: {payload?.notes || 'None'}</Text>
        <Text style={styles.detailRowText}>Total: {formatCurrency(Number(payload?.total_amount || 0))}</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded((prev) => !prev)} style={styles.headerTitleWrap}>
          <Text style={styles.title}>🏛️ Function Rooms</Text>
          <Text style={styles.subtitle}>
            {expanded ? 'Tap to minimize' : nextBooking ? `Next: ${nextBooking.booker_name} • ${formatDateLabel(nextBooking.booking_date)}${(nextBooking.booking_date_end && nextBooking.booking_date_end !== nextBooking.booking_date) ? ` – ${formatDateLabel(nextBooking.booking_date_end)}` : ''}` : 'No upcoming bookings'}
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.toggleButton} onPress={() => setExpanded((prev) => !prev)}>
            <Text style={styles.toggleButtonText}>{expanded ? 'Hide' : 'View'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={openCreateModal}>
            <Text style={styles.primaryButtonText}>+ New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!expanded ? (
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>{upcomingBookings.length} upcoming bookings</Text>
          {nextBooking ? (
            <>
              <Text style={styles.summaryTitle}>{nextBooking.booker_name}</Text>
              <Text style={styles.summaryMeta}>{roomNameMap.get(nextBooking.function_room_id) || 'Function room'} • {formatDateLabel(nextBooking.booking_date)}{(nextBooking.booking_date_end && nextBooking.booking_date_end !== nextBooking.booking_date) ? ` – ${formatDateLabel(nextBooking.booking_date_end)}` : ''}</Text>
              <Text style={styles.summaryMeta}>{nextBooking.start_time} - {nextBooking.end_time}</Text>
            </>
          ) : (
            <Text style={styles.summaryMeta}>No function room bookings currently scheduled.</Text>
          )}
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Text style={styles.label}>Upcoming bookings</Text>
            <Text style={styles.toolbarValue}>{upcomingBookings.length} active</Text>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#fbbf24" />
              <Text style={styles.loadingText}>Loading function room schedule...</Text>
            </View>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomChipsWrap}>
                {rooms.map((room) => {
                  const roomCount = upcomingBookings.filter((b) => {
                    const roomIds = b.function_room_ids && b.function_room_ids.length > 0 ? b.function_room_ids : [b.function_room_id]
                    return roomIds.includes(room.id)
                  }).length
                  return (
                    <TouchableOpacity
                      key={room.id}
                      style={[styles.roomChip, form.selectedRoomIds.includes(room.id) && styles.roomChipActive]}
                      onPress={() => setForm((prev) => {
                        const alreadySelected = prev.selectedRoomIds.includes(room.id)
                        const nextSelected = alreadySelected
                          ? prev.selectedRoomIds.filter((id) => id !== room.id)
                          : [...prev.selectedRoomIds, room.id]
                        const primaryRoomId = nextSelected[0] || room.id
                        return {
                          ...prev,
                          function_room_id: primaryRoomId,
                          selectedRoomIds: nextSelected.length ? nextSelected : [room.id],
                        }
                      })}
                    >
                      <Text style={[styles.roomChipText, form.selectedRoomIds.includes(room.id) && styles.roomChipTextActive]}>{room.name}</Text>
                      <Text style={styles.roomChipMeta}>{roomCount} booked</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>

              <View style={styles.bookingList}>
                {upcomingBookings.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyIcon}>🗓️</Text>
                    <Text style={styles.emptyTitle}>No upcoming bookings</Text>
                    <Text style={styles.emptyBody}>Create a new function room booking to schedule an event.</Text>
                  </View>
                ) : (
                  upcomingBookings.map((booking) => {
                    const selectedEquipmentTotal = booking.rented_equipments.reduce((sum, item) => sum + Number(item.rental_price || 0), 0)
                    return (
                      <TouchableOpacity key={booking.id} onPress={() => openEditModal(booking)} activeOpacity={0.8}>
                        <View style={styles.bookingCard}>
                          <View style={styles.bookingTopRow}>
                            <View style={styles.bookingTitleWrap}>
                              <Text style={styles.bookingName}>{booking.booker_name}</Text>
                              <Text style={styles.bookingMeta}>{booking.room_names || roomNameSummary(booking.function_room_ids && booking.function_room_ids.length > 0 ? booking.function_room_ids : [booking.function_room_id])}</Text>
                            </View>
                            <View style={[styles.statusPill, booking.status === 'CANCELLED' ? styles.statusCancelled : styles.statusDefault]}>
                              <Text style={styles.statusText}>{booking.status}</Text>
                            </View>
                          </View>

                          <Text style={styles.bookingMeta}>Date: {formatDateLabel(booking.booking_date)}{(booking.booking_date_end && booking.booking_date_end !== booking.booking_date) ? ` – ${formatDateLabel(booking.booking_date_end)}` : ''}</Text>
                          <Text style={styles.bookingTime}>{booking.start_time} - {booking.end_time}</Text>
                          <Text style={styles.bookingMeta}>Phone: {booking.phone_number || 'Not provided'}</Text>
                          <Text style={styles.bookingMeta}>Food budget: {formatCurrency(Number(booking.food_budget || 0))}</Text>
                          <Text style={styles.bookingMeta}>Rental add-ons: {formatCurrency(selectedEquipmentTotal)}</Text>
                          <Text style={styles.bookingMeta}>Total: {formatCurrency(Number(booking.total_amount || 0))}</Text>

                          {booking.banquet_food_notes ? (
                            <Text style={styles.bookingMeta}>Menu notes: {booking.banquet_food_notes}</Text>
                          ) : null}

                          <View style={styles.bookingActions}>
                            <TouchableOpacity style={styles.callButton} onPress={() => callBooker(booking.phone_number)}>
                              <Text style={styles.callButtonText}>📞 Call</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallActionButton} onPress={() => updateBookingStatus(booking.id, 'CONFIRMED')}>
                              <Text style={styles.smallActionText}>Confirm</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallActionButtonSecondary} onPress={() => updateBookingStatus(booking.id, 'COMPLETED')}>
                              <Text style={styles.smallActionTextSecondary}>Complete</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallActionButtonDanger} onPress={() => updateBookingStatus(booking.id, 'CANCELLED')}>
                              <Text style={styles.smallActionTextDanger}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                          <Text style={styles.editHint}>Tap to edit details</Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })
                )}
              </View>
            </>
          )}
        </>
      )}

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.modalBacking}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingBookingId ? 'Edit Function Room Booking' : 'New Function Room Booking'}</Text>
              <TouchableOpacity onPress={closeModal}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.fieldTitle}>Rooms</Text>
              <Text style={styles.helperText}>Select one or more rooms for this booking.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomSelectRow}>
                {rooms.map((room) => {
                  const selected = form.selectedRoomIds.includes(room.id)
                  return (
                    <TouchableOpacity
                      key={room.id}
                      style={[styles.selectPill, selected && styles.selectPillActive]}
                      onPress={() => setForm((prev) => {
                        const alreadySelected = prev.selectedRoomIds.includes(room.id)
                        const nextSelected = alreadySelected
                          ? prev.selectedRoomIds.filter((id) => id !== room.id)
                          : [...prev.selectedRoomIds, room.id]
                        const primaryRoomId = nextSelected[0] || room.id
                        return {
                          ...prev,
                          function_room_id: primaryRoomId,
                          selectedRoomIds: nextSelected.length ? nextSelected : [room.id],
                        }
                      })}
                    >
                      <Text style={[styles.selectPillText, selected && styles.selectPillTextActive]}>{room.name}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>

              <Text style={styles.fieldTitle}>Booker details</Text>
              <TextInput placeholder="Booker full name" value={form.booker_name} onChangeText={(text) => setForm((prev) => ({ ...prev, booker_name: text }))} style={styles.input} />
              <TextInput placeholder="Mobile / cell phone" value={form.phone_number} onChangeText={(text) => setForm((prev) => ({ ...prev, phone_number: text }))} style={styles.input} keyboardType="phone-pad" />

              <Text style={styles.fieldTitle}>Schedule</Text>
              <Text style={styles.helperText}>For single-day events, set end date = start date.</Text>
              <View style={styles.twoCol}>
                <TextInput value={form.booking_date} onChangeText={(text) => setForm((prev) => ({ ...prev, booking_date: text }))} style={[styles.input, styles.twoColInput]} placeholder="Start YYYY-MM-DD" />
                <TextInput value={form.booking_date_end} onChangeText={(text) => setForm((prev) => ({ ...prev, booking_date_end: text }))} style={[styles.input, styles.twoColInput]} placeholder="End YYYY-MM-DD" />
              </View>
              <View style={styles.twoCol}>
                <TextInput value={form.start_time} onChangeText={(text) => setForm((prev) => ({ ...prev, start_time: text }))} style={[styles.input, styles.twoColInput]} placeholder="09:00" />
                <TextInput value={form.end_time} onChangeText={(text) => setForm((prev) => ({ ...prev, end_time: text }))} style={[styles.input, styles.twoColInput]} placeholder="11:00" />
              </View>

              <Text style={styles.fieldTitle}>Catering</Text>
              <TextInput
                value={form.food_budget}
                onChangeText={(text) => setForm((prev) => ({ ...prev, food_budget: text }))}
                style={styles.input}
                keyboardType="numeric"
                placeholder="Food budget"
              />
              <TextInput
                value={form.banquet_food_notes}
                onChangeText={(text) => setForm((prev) => ({ ...prev, banquet_food_notes: text }))}
                style={[styles.input, styles.textArea]}
                multiline
                placeholder="Banquet menu requests / catering notes"
              />

              <Text style={styles.fieldTitle}>Equipment rentals</Text>
              {equipment.map((item) => {
                const checked = form.selectedEquipmentIds.includes(item.id)
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => setForm((prev) => ({
                      ...prev,
                      selectedEquipmentIds: checked
                        ? prev.selectedEquipmentIds.filter((id) => id !== item.id)
                        : [...prev.selectedEquipmentIds, item.id],
                    }))}
                    style={[styles.checkRow, checked && styles.checkRowActive]}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]} />
                    <Text style={styles.checkLabel}>{item.name}</Text>
                    <Text style={styles.priceText}>{formatCurrency(Number(item.rental_price || 0))}</Text>
                  </TouchableOpacity>
                )
              })}

              <Text style={styles.fieldTitle}>Payment</Text>
              <TextInput
                value={form.downpayment_amount}
                onChangeText={(text) => setForm((prev) => ({ ...prev, downpayment_amount: text }))}
                style={styles.input}
                keyboardType="numeric"
                placeholder="Downpayment amount"
              />
              <Text style={styles.summaryRow}>Equipment total: {formatCurrency(equipmentTotal)}</Text>
              <Text style={styles.summaryRow}>Food budget: {formatCurrency(parseNumber(form.food_budget))}</Text>
              <Text style={styles.summaryTotal}>Estimated total: {formatCurrency(totalBookingValue)}</Text>

              <Text style={styles.fieldTitle}>Notes</Text>
              <TextInput
                value={form.notes}
                onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}
                style={[styles.input, styles.textArea]}
                multiline
                placeholder="Special instructions or internal notes"
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={closeModal}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={saving}>
                  <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : editingBookingId ? 'Update Booking' : 'Save Booking'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    padding: 18,
    marginTop: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 18,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  toggleButton: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
  },
  toggleButtonText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 11,
  },
  primaryButton: {
    backgroundColor: '#fbbf24',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 12,
  },
  summaryBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
  },
  summaryLabel: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summaryTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
  },
  summaryMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
  },
  detailSection: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  detailTitleText: {
    color: '#fbbf24',
    fontWeight: '800',
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailRowText: {
    color: '#e2e8f0',
    fontSize: 11,
    marginTop: 4,
  },
  toolbar: {
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 0,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toolbarValue: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    backgroundColor: '#020617',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roomChipsWrap: {
    marginBottom: 12,
  },
  roomChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  roomChipActive: {
    backgroundColor: 'rgba(251,191,36,0.14)',
    borderColor: 'rgba(251,191,36,0.4)',
  },
  roomChipText: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 12,
  },
  roomChipTextActive: {
    color: '#fbbf24',
  },
  roomChipMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  bookingList: {
    gap: 10,
  },
  emptyCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  emptyIcon: {
    fontSize: 26,
    marginBottom: 8,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  emptyBody: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },
  bookingCard: {
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
  },
  bookingTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bookingTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  bookingName: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
  },
  bookingMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 3,
  },
  bookingTime: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 12,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusDefault: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
  },
  statusCancelled: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  statusText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  bookingActions: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  editHint: {
    marginTop: 8,
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  callButton: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  callButtonText: {
    color: '#4ade80',
    fontWeight: '800',
    fontSize: 12,
  },
  smallActionButton: {
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
  },
  smallActionText: {
    color: '#4ade80',
    fontWeight: '700',
    fontSize: 11,
  },
  smallActionButtonSecondary: {
    backgroundColor: 'rgba(96,165,250,0.14)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.35)',
  },
  smallActionTextSecondary: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 11,
  },
  smallActionButtonDanger: {
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  smallActionTextDanger: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 11,
  },
  modalBacking: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(2,6,23,0.8)',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 18,
  },
  closeText: {
    color: '#cbd5e1',
    fontSize: 20,
  },
  fieldTitle: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  roomSelectRow: {
    marginBottom: 8,
  },
  helperText: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 10,
  },
  selectPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginRight: 8,
  },
  selectPillActive: {
    borderColor: 'rgba(251,191,36,0.4)',
    backgroundColor: 'rgba(251,191,36,0.12)',
  },
  selectPillText: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 11,
  },
  selectPillTextActive: {
    color: '#fbbf24',
  },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    marginBottom: 8,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  twoCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  twoColInput: {
    flex: 1,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  checkRowActive: {
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.25)',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#fbbf24',
    borderColor: '#fbbf24',
  },
  checkLabel: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  priceText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
  },
  summaryRow: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 4,
  },
  summaryTotal: {
    color: '#fbbf24',
    fontWeight: '800',
    fontSize: 14,
    marginTop: 6,
  },
  errorText: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    color: '#fca5a5',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.32)',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    fontSize: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 18,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontWeight: '800',
    fontSize: 12,
  },
})
