import { supabase } from './supabase'
import type { RequestItem } from '@hotel-qr/supabase/types'

export interface HotelCallQueueState {
  hasActiveCall: boolean
  activeCall: RequestItem | null
  isCurrentRoomCalling: boolean
  pendingCallsCount: number
  currentRoomQueuePosition: number | null
}

/**
 * Checks whether front desk is currently on an active LIVE_CALL or has pending queued calls.
 */
export async function checkActiveHotelCall(
  hotelId: string,
  currentRoomId?: string
): Promise<HotelCallQueueState> {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('request_type', 'LIVE_CALL')
      .in('status', ['PENDING', 'LIVE'])
      .order('created_at', { ascending: true })

    if (error) {
      console.warn('[callQueueService] Error fetching call queue:', error)
      return {
        hasActiveCall: false,
        activeCall: null,
        isCurrentRoomCalling: false,
        pendingCallsCount: 0,
        currentRoomQueuePosition: null,
      }
    }

    const calls = (data as RequestItem[]) || []
    const liveCall = calls.find((c) => c.status === 'LIVE') || null
    const pendingCalls = calls.filter((c) => c.status === 'PENDING')

    // Check if another room is actively on a call (or pending before us)
    const currentRoomCallIndex = currentRoomId
      ? calls.findIndex((c) => c.room_id === currentRoomId)
      : -1

    const isCurrentRoomCalling = currentRoomCallIndex !== -1
    const currentRoomQueuePosition =
      currentRoomCallIndex >= 0 ? currentRoomCallIndex + 1 : null

    // Line is considered busy if there is a LIVE call from another room,
    // or pending calls ahead of this room
    const hasActiveCall = liveCall !== null && (!currentRoomId || liveCall.room_id !== currentRoomId)

    return {
      hasActiveCall,
      activeCall: liveCall,
      isCurrentRoomCalling,
      pendingCallsCount: pendingCalls.length,
      currentRoomQueuePosition,
    }
  } catch (err) {
    console.error('[callQueueService] Exception in checkActiveHotelCall:', err)
    return {
      hasActiveCall: false,
      activeCall: null,
      isCurrentRoomCalling: false,
      pendingCallsCount: 0,
      currentRoomQueuePosition: null,
    }
  }
}

/**
 * Subscribes to real-time call queue changes for a hotel.
 * Automatically runs an initial check and invokes callback on any request INSERT/UPDATE/DELETE.
 */
export function subscribeToCallQueue(
  hotelId: string,
  callback: (queueState: HotelCallQueueState) => void,
  currentRoomId?: string
): () => void {
  // Fetch initial state
  checkActiveHotelCall(hotelId, currentRoomId).then(callback)

  const channelId = `call_queue_${hotelId}_${Date.now()}`
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'requests',
        filter: `hotel_id=eq.${hotelId}`,
      },
      async (payload) => {
        // Only react to LIVE_CALL changes or potential status transitions
        const newRecord = payload.new as Partial<RequestItem> | undefined
        const oldRecord = payload.old as Partial<RequestItem> | undefined

        const isLiveCall =
          newRecord?.request_type === 'LIVE_CALL' ||
          oldRecord?.request_type === 'LIVE_CALL'

        if (isLiveCall || payload.eventType === 'DELETE') {
          const updatedState = await checkActiveHotelCall(hotelId, currentRoomId)
          callback(updatedState)
        }
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * Cancels a live call request when guest closes tab or cancels before answered.
 */
export async function cancelLiveCallRequest(requestId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('requests') as any)
      .update({
        status: 'CANCELLED',
        call_ended_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .in('status', ['PENDING', 'LIVE'])
  } catch (err) {
    console.warn('[callQueueService] Failed to cancel live call request:', err)
  }
}
