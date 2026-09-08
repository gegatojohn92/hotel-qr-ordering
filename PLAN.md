# Feature Blueprint: Guest Chat Session Isolation, Phone Capture & Staff App Room/Call Enhancements

## 1. System Overview & Objectives
This feature enhances the real-time guest and staff hybrid chat architecture across `apps/web` (Guest Concierge Web App) and `apps/staff-app` (Staff Android & Tablet App). It introduces guest session isolation for data privacy, pre-chat phone capture for guaranteed reachability, accurate hotel room number resolution, and one-tap direct dialing for staff.

### Core Problems & Architectural Solutions:
1. **Guest Chat Privacy & Cross-Guest History Leakage**:
   - **Problem**: Conversations in `guest_conversations` were previously queried and created purely by `room_id`. If Guest A from Room 302 checked out or closed their session and Guest B checked into Room 302 and scanned the room's QR code, Guest B could view Guest A's previous conversation history, complaints, and personal details.
   - **Solution**: Bind each conversation to an active `guest_sessions` record (`session_id`). In `apps/web`, query and filter chat history strictly by `room_id` **AND** `session_id`. When a new guest scans the QR code, a fresh guest session is initialized, ensuring a completely blank, private conversation history.
2. **Chat Disconnection Fallback & Pre-Chat Phone Requirement**:
   - **Problem**: Guests who chat with the AI bot or request staff handoff frequently switch tabs, lock their phones, or experience disconnections. If staff replies minutes later, the response is missed.
   - **Solution**: When a guest clicks or uses the chat bot FAB, trigger `PhoneCaptureModal` if a verified phone number is not yet present in session storage. The captured phone number is saved to `guest_sessions` and `guest_conversations.guest_phone` for staff callback.
3. **Incorrect Room Number in Staff App**:
   - **Problem**: `GuestChatModule` and `ActiveChatScreen` displayed raw UUID trailing slices (e.g., `…B84F`) instead of the human-readable room number.
   - **Solution**: Execute relational joins (`.select('*, rooms(room_number)')`), matching the pattern of `CallQueue`, `DedicatedCallModule`, and `TaskQueue` to display `Room 302`.
4. **Direct Phone Call Mode for Staff**:
   - **Problem**: Staff handling chat escalations had no one-touch method to ring the guest directly for urgent questions.
   - **Solution**: Render a clickable phone badge beside the room number in both the conversation queue card and the active chat header, triggering `Linking.openURL('tel:${phone}')`.

---

## 2. File Index & Scope

### Files to Modify:
1. [`packages/supabase/types/index.ts`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/packages/supabase/types/index.ts):
   - Add `session_id?: string | null` and `guest_phone?: string | null` to `GuestConversation` interface.
   - Add relational `rooms?: { room_number: string } | null` typing.
   - Update Database schema typing for `guest_conversations`.
2. [`apps/web/app/app/stay/components/PhoneCaptureModal.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/app/stay/components/PhoneCaptureModal.tsx):
   - Add optional `title?: string` and `description?: string` props with backward-compatible defaults.
   - Ensure the newly inserted `guest_sessions.id` is saved to `sessionStorage.setItem('hotel_guest_session_${roomId}', sessionData.id)` to guarantee immediate session synchronization.
3. [`apps/web/app/app/stay/components/GuestChatWidget.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/app/stay/components/GuestChatWidget.tsx):
   - Read active `sessionId` from `sessionStorage.getItem('hotel_guest_session_${roomId}')`.
   - Update `loadConversation`: query `guest_conversations` where `room_id = effectiveRoomId AND session_id = sessionId AND status != 'RESOLVED'`.
   - When the guest clicks the chat FAB or attempts to send a message, verify if `getStoredGuestPhone()` exists. If missing, show `PhoneCaptureModal` with chat-specific guidance ("Please enter your mobile phone number in case the chat disconnects or staff needs to follow up on your request").
   - Include both `session_id` and `guest_phone` when posting to `/api/chat/send`.
4. [`apps/web/app/api/chat/send/route.ts`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/api/chat/send/route.ts):
   - Receive `session_id` and `guest_phone` in the request body.
   - When searching for existing active conversations, match `room_id = room_id AND session_id = session_id AND status != 'RESOLVED'`.
   - When creating a new conversation, record `session_id` and `guest_phone`.
   - If `guest_phone` is omitted, fallback to querying `guest_sessions` by `session_id` or `room_id`.
5. [`apps/web/app/api/chat/handoff/route.ts`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/api/chat/handoff/route.ts):
   - Include `guest_phone` in push notification payload (`[Phone: ${phone}]`) sent to Front Desk staff.
6. [`apps/staff-app/components/GuestChatModule.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/staff-app/components/GuestChatModule.tsx):
   - Update query to `.select('*, rooms(room_number)')`.
   - Replace UUID slice (`…${conv.room_id.slice(-4)}`) with `Room ${conv.rooms?.room_number || 'Room'}`.
   - Render a direct-dial badge beside the room number (`📞 ${conv.guest_phone}`) invoking `Linking.openURL('tel:${conv.guest_phone}')`.
7. [`apps/staff-app/components/ActiveChatScreen.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/staff-app/components/ActiveChatScreen.tsx):
   - Update `GuestConversation` interface with `session_id`, `guest_phone`, and `rooms?: { room_number: string } | null`.
   - Display `Room ${conversation.rooms?.room_number || 'Room'}` in the header.
   - Add a direct-dial phone button beside room title in header (`📞 Call ${phone}`) invoking `Linking.openURL('tel:${phone}')`.

### New Files to Create:
1. `packages/supabase/migrations/28_guest_chat_session_and_phone.sql`:
   - Adds `session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL` to `public.guest_conversations`.
   - Adds `guest_phone TEXT` to `public.guest_conversations`.
   - Creates indexes `idx_guest_conversations_session_id` and `idx_guest_conversations_guest_phone`.

### Dependencies/Packages:
- Pure TypeScript/React Native implementation. No new packages required.
- **100% OTA-Safe** for Expo Android builds.

---

## 3. Step-by-Step Execution Checklist

### Phase 1: Database Migration & Schema Types
- [x] Task 1.1: Create SQL migration `packages/supabase/migrations/28_guest_chat_session_and_phone.sql`:
  - `ALTER TABLE public.guest_conversations ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL;`
  - `ALTER TABLE public.guest_conversations ADD COLUMN IF NOT EXISTS guest_phone TEXT;`
  - `CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id ON public.guest_conversations(session_id);`
  - `CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone ON public.guest_conversations(guest_phone);`
- [x] Task 1.2: Update `packages/supabase/types/index.ts`:
  - Add `session_id: string | null` and `guest_phone: string | null` to `GuestConversation`.
  - Add relational `rooms?: { room_number: string } | null` typing.
  - Update Database schema definition for `guest_conversations`.

### Phase 2: Guest Web Session Scoping & Phone Capture Prompt (`apps/web`)
- [x] Task 2.1: Enhance `apps/web/app/app/stay/components/PhoneCaptureModal.tsx`:
  - Add optional `title?: string` and `description?: string` props with sensible fallback defaults.
  - Ensure `sessionStorage.setItem('hotel_guest_session_${roomId}', data.id)` is stored on successful session creation.
- [x] Task 2.2: Update `apps/web/app/app/stay/components/GuestChatWidget.tsx`:
  - Read `sessionId` from `sessionStorage.getItem('hotel_guest_session_${roomId}')`.
  - Scope `loadConversation` query: `.eq('room_id', effectiveRoomId).eq('session_id', sessionId).neq('status', 'RESOLVED')`.
  - On chat FAB press: verify `getStoredGuestPhone()`. If null, display `PhoneCaptureModal` with description: *"Please enter your mobile phone number in case the chat is disconnected or our staff needs to follow up."*
  - On phone modal success: save phone, initialize conversation with `session_id`, and open drawer.
  - On `handleSend()`: verify phone number is present; include `session_id` and `guest_phone` in the POST payload to `/api/chat/send`.
- [x] Task 2.3: Update `apps/web/app/api/chat/send/route.ts`:
  - Extract `session_id` and `guest_phone` from body.
  - If `convId` is not provided, locate existing conversation matching `hotel_id`, `room_id`, AND `session_id` (`status != 'RESOLVED'`).
  - When inserting new conversation, write `session_id` and `guest_phone`.
  - If `guest_phone` is not passed, fetch latest phone from `guest_sessions` by `session_id` or `room_id`.
  - Ensure conversation last message update keeps `guest_phone` and `session_id` intact.
- [x] Task 2.4: Update `apps/web/app/api/chat/handoff/route.ts`:
  - Include guest phone in push notification payload sent to Front Desk.

### Phase 3: Staff App Room Number & Direct Calling (`apps/staff-app`)
- [x] Task 3.1: Update `apps/staff-app/components/GuestChatModule.tsx`:
  - Update query to `.select('*, rooms(room_number)')` with fallback query if join fails.
  - Display actual room number: `Room ${conv.rooms?.room_number || 'Room'}` instead of `…${conv.room_id.slice(-4)}`.
  - Render a clickable phone badge beside room title on conversation cards:
    - If `conv.guest_phone` exists, display `📞 ${conv.guest_phone}` and trigger `Linking.openURL('tel:${conv.guest_phone}')`.
    - If no phone exists, display `📱 No phone`.
- [x] Task 3.2: Update `apps/staff-app/components/ActiveChatScreen.tsx`:
  - Update `GuestConversation` interface with `session_id`, `guest_phone`, and `rooms?: { room_number: string } | null`.
  - In header: render `💬 Room ${conversation.rooms?.room_number || 'Room'}`.
  - Beside room title in header: render direct-dial button `📞 Call ${phone}` linking to device dialer with user-friendly alert on error.
- [x] Task 3.3: Maintain Realtime synchronization on `guest_conversations` so room number and phone reflect instantly when a conversation is initiated.

### Phase 4: Verification & Compiler Checks
- [x] Task 4.1: Run TypeScript compiler check on `apps/web`:
  `npx -p typescript tsc --noEmit -p apps/web/tsconfig.json`
- [x] Task 4.2: Run TypeScript compiler check on `apps/staff-app`:
  `npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json`
- [x] Task 4.3: Validate cross-device privacy and direct call flows.

---

## 4. Edge Cases & Safety Checks

1. **Guest Session Lifecycle & Device Separation**:
   - **Scenario**: Guest A checks out; Guest B checks in and scans QR code on their device.
   - **Safety Guarantee**: Guest B's device generates or receives a fresh `guest_sessions` ID in `sessionStorage`. Because `GuestChatWidget` queries `eq('session_id', currentSessionId)`, Guest B sees a clean chat widget without Guest A's messages or phone number.
2. **Same Guest Page Reload**:
   - **Scenario**: Guest reloads the page or navigates between concierge subroutes (`/app/stay/spa`, `/app/stay/food`).
   - **Safety Guarantee**: The `hotel_guest_session_${roomId}` and `hotel_guest_phone_number` persist in `sessionStorage` across same-tab navigations, allowing the guest to seamlessly resume their ongoing chat.
3. **Devices Without Telephony Hardware (WiFi Tablets)**:
   - **Safety Guarantee**: In `apps/staff-app`, `Linking.openURL('tel:${phone}')` is wrapped in `.catch()` with an `Alert.alert('Cannot Open Dialer', 'Unable to open the phone dialer on this device.')` to prevent crashes on non-phone tablet hardware.
4. **Supabase Foreign Key Join Resilience**:
   - **Safety Guarantee**: If RLS or schema cache temporarily fails on `rooms(room_number)`, `GuestChatModule` implements a fallback `.select('*')` query to prevent UI crashes.

---

## 5. Verification & Testing Steps

### 1. Multi-Guest Chat Isolation Test:
1. Open Incognito Window 1 at `/app/stay?room=<ROOM_ID>&hash=<HASH>`.
2. Click chat FAB, input Phone `+63 917 111 2222`, send: *"Hello, I am Guest 1"*.
3. Verify message is delivered and AI responds.
4. Open Incognito Window 2 (simulating a new guest on another device) at the same room URL.
5. Click chat FAB in Window 2.
6. Verify Window 2 shows the PhoneCaptureModal and, upon entry, displays a **completely clean, empty chat history** (Guest 1's messages are not visible).

### 2. Staff App Room Number & Direct Calling Test:
1. Open `apps/staff-app`.
2. Inspect the **Guest Chat** module list:
   - Verify card displays **Room 302** (actual room number from `rooms` table, not UUID slice).
   - Verify `📞 +63 917 111 2222` appears beside the room title.
3. Tap the phone badge and confirm the native dialer opens.
4. Tap the card to open `ActiveChatScreen`:
   - Verify header shows `💬 Room 302`.
   - Verify direct call button `📞 Call +63 917 111 2222` is visible and functional.

### 3. Automated Type & Build Checks:
```bash
# Verify apps/web TypeScript
npx -p typescript tsc --noEmit -p apps/web/tsconfig.json

# Verify apps/staff-app TypeScript
npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json
```
