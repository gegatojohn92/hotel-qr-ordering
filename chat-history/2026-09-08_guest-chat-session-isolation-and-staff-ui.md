# 2026-09-08: Guest Chat Session Isolation, Staff UI Refinements & Direct Dialing

## Summary
Implemented guest session isolation for the AI concierge chat system to prevent chat history leakage across different guests in the same hotel room. Reorganized the staff app dashboard to place the guest chat module at the bottom below operational logs, added direct phone calling from the active chat header, and updated AI assistant hotel policy rules.

## Key Changes

### 1. Guest Chat Session Isolation (`apps/web`)
- **Problem**: When a new guest scanned a room QR code on their device, the chat widget fell back to querying any active conversation by `room_id`, displaying the prior guest's messages.
- **Client Isolation (`GuestChatWidget.tsx`)**:
  - Removed room-level fallback query from `loadConversation()`.
  - Scoped conversation loading strictly to `sessionStorage` (`storedConvId` or `activeSessionId`).
  - Fresh QR scans or new browser tabs default to `messages = []` and `conversation = null`, showing the clean welcome card and quick prompts.
- **Backend Isolation (`/api/chat/send/route.ts`)**:
  - Purged Step 1b fallback that reattached messages to active room conversations.
  - Ensures a brand-new conversation row is created in `guest_conversations` whenever a message is sent from a new session.
- **Session Lifecycle & Helpers (`PhoneCaptureModal.tsx`, `GuestSessionKeeper.tsx`)**:
  - Added `getOrCreateGuestSessionId()` with `crypto.randomUUID()` fallback.
  - Added `getStoredGuestConversationId()` and `storeGuestConversationId()`.

### 2. Database Schema (Migration 28)
- Files: `packages/supabase/migrations/28_add_guest_phone_session_id.sql` & `28_guest_chat_session_and_phone.sql`
- Added `session_id TEXT` and `guest_phone TEXT` to `public.guest_conversations`.
- Added indexes `idx_guest_conversations_session_id` and `idx_guest_conversations_guest_phone`.

### 3. Staff App UI & Direct Dialing (`apps/staff-app`)
- **Dashboard Layout (`App.tsx`)**:
  - Moved `<GuestChatModule />` from position 5 to the bottom of the dashboard scroll view (after `<RequestHistory />`) to prevent crowding active operational queues.
- **Header Direct Calling (`ActiveChatScreen.tsx`)**:
  - Displays guest phone number next to room badge in active chat header.
  - Added 1-tap direct call button (`tel:`) with native link handler.

### 4. AI Assistant Policy Updates (`apps/web/lib/ai-assistant.ts`)
- Updated hotel rules for early/late check-out charges, WiFi password keycard instructions, housekeeping hours, and complimentary beverage policies.

## Verification
- Both `apps/web` and `apps/staff-app` typecheck cleanly (`tsc --noEmit` passed with 0 errors).
- Clean slate verified for new QR scans without chat leakage.
