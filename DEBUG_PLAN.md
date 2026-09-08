# Bug Diagnosis & Fix Plan

## 1. Root Cause Analysis

- **Trigger:**
  A guest scans a room QR code (or accesses the guest web portal). When opening the chat widget, they immediately see the chat messages and history from a previous guest who stayed in or scanned the same room.

- **Faulty Code Path:**
  1. **`apps/web/app/app/stay/components/GuestChatWidget.tsx` — `loadConversation()` (Lines 195–246)**:
     ```typescript
     // Path B: Fallback to room-level active conversation
     if (!conv && !activeSessionId) {
       const { data: roomConv } = await supabase
         .from('guest_conversations')
         .select('*')
         .eq('room_id', effectiveRoomId)
         .eq('hotel_id', hotelIdResolved)
         .neq('status', 'RESOLVED')
         .order('created_at', { ascending: false })
         .limit(1)
         .maybeSingle()
     }
     ```
     When a new guest arrives on their mobile phone, `sessionStorage` is empty, meaning `activeSessionId` is `null`. The condition `!activeSessionId` evaluates to `true`. The code then queries Supabase for **any** non-resolved conversation in that room. It finds the previous guest's conversation, sets it to state (`setConversation(roomConv)`), and fetches and displays all previous chat messages.

  2. **`apps/web/app/api/chat/send/route.ts` — Step 1b (Lines 57–71)**:
     ```typescript
     if (!convId && !session_id) {
       const { data: existing } = await supabase
         .from('guest_conversations')
         .select('id, status')
         .eq('hotel_id', hotel_id)
         .eq('room_id', room_id)
         .neq('status', 'RESOLVED')
         ...
       if (existing?.id) {
         convId = existing.id
       }
     }
     ```
     If a guest sends a message before a session ID is registered, the backend actively recycles the room's previous conversation ID and appends the new guest's messages to the old conversation.

  3. **`apps/web/app/app/stay/components/GuestChatWidget.tsx` — `handleSend()` (Line 392)**:
     Because `loadConversation()` incorrectly populated `conversation` with the prior guest's conversation record, `handleSend()` sends `conversation_id: conversation.id` to `/api/chat/send`. The backend faithfully appends the new guest's message to the old guest's conversation.

- **Why it failed:**
  - **Inherent Flaw in Room Fallback:** Chat history was keyed to `room_id` instead of being strictly bound to the guest's unique visit/session.
  - **Session Timing Delay:** A `session_id` was only created when the guest submitted the phone modal. Prior to that action, any QR scan had `activeSessionId = null`, causing the room fallback query to fire unconditionally.
  - **Overbroad Re-use:** Even if the live DB lacked migration 28 (`session_id`), the application actively searched for prior conversations in the room instead of starting fresh for each guest visit.

---

## 2. Proposed Fix

### Strategy: Fresh Conversation Per Guest Visit / QR Scan
Every time a guest accesses the web app or scans the QR code, a fresh conversation session is established. Old conversations from the room are **never** queried or displayed to a new visitor.

1. **Purge Room-Level Fallback Queries**:
   - In `GuestChatWidget.tsx`, completely remove Path B (room-level query). A guest widget must **only** load a conversation if it matches the current visit's stored `conversation_id` or `session_id` in `sessionStorage`.
   - In `/api/chat/send/route.ts`, completely remove Step 1b (room-level fallback). If no conversation exists for the active session, `/api/chat/send` **always** creates a brand-new conversation.

2. **Immediate Visit Session Generation**:
   - When `GuestChatWidget` or `GuestSessionKeeper` mounts, immediately generate an isolated `session_id` (using `crypto.randomUUID()`) in `sessionStorage` if one is not present.
   - Store `guest_chat_conversation_id_${roomId}` in `sessionStorage` once a conversation is initiated.

3. **Per-Session Chat State**:
   - On a new phone scan or new browser session, `sessionStorage` is empty by definition.
   - `GuestChatWidget` initializes with `messages = []` and `conversation = null`.
   - The guest sees the clean AI Concierge greeting and quick action chips ("Restaurant hours?", "WiFi password?", etc.).
   - When the guest sends a message, a new conversation record is created in Supabase.
   - The guest can refresh or navigate pages within their stay (staying in the same tab/session) and their own conversation will persist.
   - Any other guest scanning the QR code in the same room will have an isolated session and will see zero messages from prior guests.

---

### Files to Modify:

| File | Line Numbers / Functions | Description of Changes |
|---|---|---|
| `apps/web/app/app/stay/components/GuestChatWidget.tsx` | `loadConversation()` (L195–264) | Remove room-level fallback query completely. Only fetch conversation if `storedConversationId` or `activeSessionId` is present. If none found, keep `messages` empty. |
| `apps/web/app/app/stay/components/GuestChatWidget.tsx` | `handleSend()` (L350–437) | Save newly created `conversation_id` to `sessionStorage` (`guest_chat_conv_${roomId}`). Ensure immediate session UUID generation if absent. |
| `apps/web/app/app/app/stay/components/PhoneCaptureModal.tsx` | `getStoredGuestSessionId` / `storeGuestSessionId` | Ensure helper automatically generates and returns a session UUID if missing for the room. |
| `apps/web/app/api/chat/send/route.ts` | Step 1b (L53–71) | Delete room-level conversation recycling. Always create a new conversation when no session-matched conversation exists. |

---

### Regression Risks:
- **Returning to same chat during active stay:** Navigating between `/app/stay` and `/app/stay/order` will continue to work seamlessly because `sessionStorage` persists across sub-routes within the same browser tab.
- **Staff App Impact:** None. Staff will see distinct conversations per guest session instead of messages from multiple guests merged into one thread.
- **DB Schema Independence:** Even if migration 28 is not yet executed in Supabase, client-side session isolation via `sessionStorage` prevents any guest from ever seeing another guest's chat history.

---

## 3. Verification Checklist

- [x] Task 1: Update `GuestChatWidget.tsx` to remove room-level fallback and isolate conversation loading to `sessionStorage`.
- [x] Task 2: Update `/api/chat/send/route.ts` to remove room-level conversation recycling.
- [x] Task 3: Update `PhoneCaptureModal.tsx` / session helpers to guarantee immediate UUID generation on visit.
- [x] Task 4: Run typecheck across `apps/web` and `apps/staff-app` (both passed with 0 errors).
- [x] Task 5: Verify isolation logic:
  - Any new visitor or QR scan in a fresh session starts with a clean slate (`messages = []`).
  - First sent message triggers creation of an isolated conversation.
  - No past chat history from prior room guests is ever queried or displayed.
