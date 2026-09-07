'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import GuestSessionKeeper from './GuestSessionKeeper'
import GuestChatWidget from './GuestChatWidget'

const supabase = createSupabaseBrowserClient()

function StayRootManager() {
  const searchParams = useSearchParams()
  const roomId = searchParams.get('room')
  const [hotelId, setHotelId] = useState('00000000-0000-0000-0000-000000000001')
  const [roomNumber, setRoomNumber] = useState('')

  useEffect(() => {
    if (!roomId) return

    let isMounted = true

    async function fetchRoomDetails() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('rooms')
          .select('room_number, hotel_id')
          .eq('id', roomId)
          .maybeSingle()

        if (!error && data && isMounted) {
          if (data.room_number) setRoomNumber(String(data.room_number))
          if (data.hotel_id) setHotelId(String(data.hotel_id))
        }
      } catch (err) {
        console.debug('[StayRootManager] Error fetching room:', err)
      }
    }

    fetchRoomDetails()

    return () => {
      isMounted = false
    }
  }, [roomId])

  if (!roomId) return null

  return (
    <GuestSessionKeeper
      roomId={roomId}
      hotelId={hotelId}
      roomNumber={roomNumber}
    />
  )
}

export default function StayRootClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <StayRootManager />
        {/* Global persistent chat widget across all stay subroutes */}
        <GuestChatWidget />
      </Suspense>
      {children}
    </>
  )
}
