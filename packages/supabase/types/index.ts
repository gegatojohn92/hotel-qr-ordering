export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================================
// Core Entity Types
// ============================================================

// ── Guest Web Theme & Content CMS ───────────────────────────

export type GuestThemeMode =
  | 'DARK_GOLD'
  | 'CLEAN_LIGHT'
  | 'MINIMAL_WHITE'
  | 'LUXURY_NAVY'
  | 'CUSTOM'

export interface HotelThemeConfig {
  bg_primary: string
  bg_surface: string
  text_primary: string
  text_secondary: string
  accent_color: string
  border_color: string
}

export interface GuestWebContentConfig {
  landing: {
    welcome_title: string
    welcome_subtitle: string
    room_greeting_prefix: string
    hero_banner_text: string
  }
  dining: {
    title: string
    subtitle: string
    fnb_call_button_text: string
    special_instructions_placeholder: string
  }
  spa: {
    title: string
    subtitle: string
  }
  requests: {
    title: string
    subtitle: string
  }
  ai_chat: {
    widget_title: string
    welcome_message: string
    quick_prompt_1: string
    quick_prompt_2: string
  }
  footer: {
    copyright_text: string
    support_contact_text: string
  }
}

export interface GuestWebSettings {
  theme_mode: GuestThemeMode
  theme_config: HotelThemeConfig | null
  content_config: Partial<GuestWebContentConfig> | null
}

export interface Hotel {
  id: string
  name: string
  address: string | null
  phone: string | null
  fnb_phone_number?: string | null
  logo_url: string | null
  color_scheme: string | null
  service_charge_enabled?: boolean
  service_charge_pct?: number
  theme_mode?: GuestThemeMode | string | null
  theme_config?: HotelThemeConfig | null
  content_config?: Partial<GuestWebContentConfig> | null
  created_at: string
}

export interface Room {
  id: string
  hotel_id: string
  room_number: string
  floor: string | null
  room_type: 'STANDARD' | 'DELUXE' | 'SUITE' | 'PENTHOUSE'
  qr_auth_hash: string
  is_active: boolean
  created_at: string
}

export interface GuestSession {
  id: string
  room_id: string
  hotel_id: string
  phone_number: string | null
  status: 'ACTIVE' | 'EXPIRED' | 'CHECKED_OUT'
  created_at: string
  expires_at: string
}

export interface RequestItem {
  id: string
  hotel_id: string
  room_id: string
  request_type: 'CALL_REQUEST' | 'SPA_BOOKING' | 'FOOD_ORDER' | 'TASK' | string
  status: 'PENDING' | 'PENDING_ON_CALL' | 'CLAIMED' | 'LIVE' | 'CONFIRMED' | 'DECLINED' | 'PREPARING' | 'RESOLVED' | 'CANCELLED' | 'ESCALATED_L1'
  payload: Json
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
  agora_channel?: string | null
  claimed_by_staff_id?: string | null
  call_started_at?: string | null
  call_ended_at?: string | null
  call_queue_position?: number | null
}

export type DietaryTag = 'VEGETARIAN' | 'VEGAN' | 'GLUTEN_FREE' | 'HALAL' | 'NUT_FREE' | 'DAIRY_FREE'

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type TargetDepartment = 'HOUSEKEEPING' | 'MAINTENANCE' | 'FRONT_DESK'

export interface CatalogItem {
  id: string
  hotel_id: string
  department: 'SPA' | 'F_AND_B' | 'ROOM_REQUEST'
  category: string | null
  name: string
  description: string | null
  price: number
  duration_mins: number | null
  requires_on_call: boolean
  is_available: boolean
  dietary_tags: string[]
  sort_order: number
  image_url: string | null
  // Phase 4: Task routing fields
  priority: TaskPriority | null
  target_sla_mins: number | null
  target_department: TargetDepartment | null
  created_at: string
}

export type StaffRole = 'FRONT_DESK' | 'KITCHEN' | 'HOUSEKEEPING' | 'SPA' | 'MANAGER' | 'FNB' | 'ADMIN'

export interface StaffUser {
  id: string
  hotel_id: string
  full_name: string
  email: string
  password?: string
  role: StaffRole
  push_token?: string | null
  is_active: boolean
  created_at: string
  updated_at?: string
  // Per-staff notification preferences (Migration 29)
  mute_guest_chat_push?: boolean
  suppress_push_when_active?: boolean
  quiet_hours_from_override?: number | null
  quiet_hours_to_override?: number | null
}

export interface MenuCategory {
  id: string
  hotel_id: string
  name: string
  icon?: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at?: string
}

export interface SpaTimeSlot {
  id: string
  hotel_id: string
  slot_time: string
  is_available: boolean
  is_on_call: boolean
  sort_order: number
  created_at: string
}

// ── F&B Cart Types ────────────────────────────────────────────

export interface CartItem {
  item: CatalogItem
  quantity: number
  special_instructions?: string
}

export type FulfillmentType = 'ROOM_SERVICE' | 'DINE_IN'
export type DeliveryPreference = 'HAND_TO_ME' | 'LEAVE_AT_DOOR'
export type ArrivalTime = 'IN_15_MINS' | 'IN_30_MINS' | 'IN_60_MINS' | 'CUSTOM'

export interface FoodOrderPayload {
  order_type: FulfillmentType
  items: Array<{ id: string; name: string; quantity: number; unit_price: number }>
  special_instructions: string
  delivery_preference?: DeliveryPreference  // Room Service only
  target_arrival_time?: ArrivalTime          // Dine-In only
  total_price: number
  subtotal?: number
  service_charge_pct?: number
  service_charge_amount?: number
}

// ── Task Request Types ──────────────────────────────────────

export interface TaskPayload {
  task_name: string
  quantity: number
  custom_notes: string
  priority: TaskPriority
  target_department: TargetDepartment
  catalog_item_id?: string
  is_custom?: boolean
  room_number?: string
  guest_phone?: string
  booked_by?: string
}

export interface SlaEscalation {
  id: string
  request_id: string
  escalation_level: number
  triggered_at: string
}

export interface AuditLog {
  id: string
  hotel_id: string
  request_id: string | null
  action: string
  actor_id: string | null
  details: Json
  created_at: string
}

export interface Therapist {
  id: string
  hotel_id: string
  full_name: string
  is_on_call: boolean
  is_active: boolean
  created_at: string
}

export interface SpaSlotLock {
  id: string
  hotel_id: string
  therapist_id: string | null
  request_id: string | null
  session_id: string | null
  start_time: string
  end_time: string
  status: 'HELD' | 'BOOKED' | 'EXPIRED' | 'CANCELLED'
  expires_at: string
  created_at: string
}

export interface NotificationSettings {
  id: string
  hotel_id: string
  reminder_interval_minutes: number
  enable_sound_alert: boolean
  max_alert_duration_seconds: number
  fnb_allowed_types: string[]
  frontdesk_allowed_types: string[]
  spa_allowed_types: string[]
  notify_same_day?: boolean
  notify_days_before?: number
  enable_guest_live_call?: boolean
  updated_at: string
  // Hotel-level push suppression behaviour (Migration 29)
  suppress_if_active?: boolean
  push_cooldown_seconds?: number
  quiet_hours_enabled?: boolean
  quiet_hours_from?: number
  quiet_hours_to?: number
}

export interface FunctionRoom {
  id: string
  hotel_id: string
  name: string
  capacity: number
  is_active: boolean
  created_at: string
}

export interface FunctionRoomEquipment {
  id: string
  hotel_id: string
  name: string
  rental_price: number
  is_active: boolean
  created_at: string
}

export interface FunctionRoomBooking {
  id: string
  hotel_id: string
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
  rented_equipments: Array<{
    id: string
    name: string
    rental_price: number
    quantity?: number
  }>
  downpayment_amount: number
  total_amount: number
  notes: string | null
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'COMPLETED'
  created_by_staff_id: string | null
  created_at: string
}

// ── Real-Time Guest & Staff Chat with Hybrid AI Assistant ───

export type GuestConversationStatus = 'BOT_ACTIVE' | 'STAFF_HANDOFF' | 'RESOLVED'
export type GuestChatSenderType = 'GUEST' | 'AI' | 'STAFF' | 'SYSTEM'

export interface GuestConversation {
  id: string
  hotel_id: string
  room_id: string
  session_id?: string | null
  guest_phone?: string | null
  status: GuestConversationStatus
  assigned_staff_id: string | null
  guest_name: string | null
  unread_guest_count: number
  unread_staff_count: number
  last_message_text: string | null
  last_message_sender: GuestChatSenderType | null
  last_message_at: string
  created_at: string
  updated_at: string
  // Push cooldown tracking (Migration 29)
  last_push_sent_at?: string | null
  rooms?: { room_number: string } | null
}

export interface GuestChatMessage {
  id: string
  conversation_id: string
  hotel_id: string
  room_id: string
  sender_type: GuestChatSenderType
  sender_staff_id: string | null
  sender_name: string
  message_text: string
  is_read: boolean
  created_at: string
}

// ── Staff Presence (Migration 29) ─────────────────────────────
// Tracks which staff member is actively viewing a conversation.
// Used by webPush.ts to suppress redundant FCM pushes.
export interface StaffPresence {
  id: string
  staff_user_id: string
  hotel_id: string
  is_active_in_conversation: boolean
  active_conversation_id: string | null
  last_seen_at: string
  updated_at: string
}

export interface BookingFormInputs {
  function_room_id: string
  booker_name: string
  phone_number: string
  booking_date: string
  booking_date_end: string
  start_time: string
  end_time: string
  food_budget: string
  banquet_food_notes: string
  selectedEquipmentIds: string[]
  notes: string
  downpayment_amount: string
  status: FunctionRoomBooking['status']
}

// ============================================================
// Joined / Extended Types (for queries with relations)
// ============================================================

export interface RoomWithHotel extends Room {
  hotel: Hotel
}

export interface GuestSessionWithRoom extends GuestSession {
  room: RoomWithHotel
}

export interface RequestWithRoom extends RequestItem {
  rooms?: Room | null
  hotels?: Hotel | null
}

// ============================================================
// QR URL Parameters
// ============================================================

export interface QRParams {
  room: string   // room UUID
  hash: string   // qr_auth_hash
}

// ============================================================
// API Response Wrappers
// ============================================================

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

// ============================================================
// Supabase Database Shape (for createClient generic)
// ============================================================

export interface Database {
  public: {
    Tables: {
      hotels: {
        Row: Hotel
        Insert: Omit<Hotel, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Hotel, 'id'>>
      }
      rooms: {
        Row: Room
        Insert: Omit<Room, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Room, 'id'>>
      }
      guest_sessions: {
        Row: GuestSession
        Insert: Omit<GuestSession, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<GuestSession, 'id'>>
      }
      requests: {
        Row: RequestItem
        Insert: {
          id?: string
          hotel_id: string
          room_id: string
          request_type: string
          status: string
          payload?: Json
          created_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          agora_channel?: string | null
          claimed_by_staff_id?: string | null
          call_started_at?: string | null
          call_ended_at?: string | null
          call_queue_position?: number | null
        }
        Update: {
          hotel_id?: string
          room_id?: string
          request_type?: string
          status?: string
          payload?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          agora_channel?: string | null
          claimed_by_staff_id?: string | null
          call_started_at?: string | null
          call_ended_at?: string | null
          call_queue_position?: number | null
        }
      }
      catalog_items: {
        Row: CatalogItem
        Insert: {
          id?: string
          hotel_id: string
          department: 'SPA' | 'F_AND_B' | 'ROOM_REQUEST'
          category?: string | null
          name: string
          description?: string | null
          price: number
          duration_mins?: number | null
          requires_on_call?: boolean
          is_available?: boolean
          dietary_tags?: string[]
          sort_order?: number
          image_url?: string | null
          priority?: TaskPriority | null
          target_sla_mins?: number | null
          target_department?: TargetDepartment | null
          created_at?: string
        }
        Update: {
          department?: 'SPA' | 'F_AND_B' | 'ROOM_REQUEST'
          category?: string | null
          name?: string
          description?: string | null
          price?: number
          duration_mins?: number | null
          requires_on_call?: boolean
          is_available?: boolean
          dietary_tags?: string[]
          sort_order?: number
          image_url?: string | null
          priority?: TaskPriority | null
          target_sla_mins?: number | null
          target_department?: TargetDepartment | null
        }
      }
      therapists: {
        Row: Therapist
        Insert: Omit<Therapist, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Therapist, 'id'>>
      }
      spa_slot_locks: {
        Row: SpaSlotLock
        Insert: Omit<SpaSlotLock, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<SpaSlotLock, 'id'>>
      }
      sla_escalations: {
        Row: SlaEscalation
        Insert: Omit<SlaEscalation, 'id' | 'triggered_at'> & { id?: string; triggered_at?: string }
        Update: Partial<Omit<SlaEscalation, 'id'>>
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<AuditLog, 'id'>>
      }
      notification_settings: {
        Row: NotificationSettings
        Insert: Omit<NotificationSettings, 'id' | 'updated_at'> & { id?: string; updated_at?: string }
        Update: Partial<Omit<NotificationSettings, 'id'>>
      }
      function_rooms: {
        Row: FunctionRoom
        Insert: Omit<FunctionRoom, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<FunctionRoom, 'id'>>
      }
      function_room_equipments: {
        Row: FunctionRoomEquipment
        Insert: Omit<FunctionRoomEquipment, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<FunctionRoomEquipment, 'id'>>
      }
      function_room_bookings: {
        Row: FunctionRoomBooking
        Insert: Omit<FunctionRoomBooking, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<FunctionRoomBooking, 'id'>>
      }
      guest_conversations: {
        Row: GuestConversation
        Insert: Omit<GuestConversation, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<GuestConversation, 'id'>>
      }
      guest_chat_messages: {
        Row: GuestChatMessage
        Insert: Omit<GuestChatMessage, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<GuestChatMessage, 'id'>>
      }
      staff_presence: {
        Row: StaffPresence
        Insert: Omit<StaffPresence, 'id'> & { id?: string }
        Update: Partial<Omit<StaffPresence, 'id'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      session_status: 'ACTIVE' | 'EXPIRED' | 'CHECKED_OUT'
      room_type: 'STANDARD' | 'DELUXE' | 'SUITE' | 'PENTHOUSE'
      request_status: 'PENDING' | 'PENDING_ON_CALL' | 'CLAIMED' | 'CONFIRMED' | 'DECLINED' | 'PREPARING' | 'RESOLVED' | 'CANCELLED' | 'ESCALATED_L1'
      department_type: 'SPA' | 'F_AND_B' | 'ROOM_REQUEST'
      slot_lock_status: 'HELD' | 'BOOKED' | 'EXPIRED' | 'CANCELLED'
    }
  }
}
