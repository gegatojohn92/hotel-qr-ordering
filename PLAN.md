# Feature Blueprint: Real-Time Guest & Staff Chat with Hybrid AI Assistant

## 1. System Overview & Objectives
This feature implements an end-to-end, bi-directional real-time messaging architecture connecting hotel guests on `apps/web` (Next.js PWA) with hotel staff on `apps/staff-app` (React Native Expo Android & PWA). 

### Key Capabilities:
1. **Hybrid AI Assistant**:
   - Automated instant AI responses for hotel FAQs (amenities, dining hours, WiFi, check-out policy, directions) powered by Gemini AI with custom hotel knowledge prompts.
   - Real-time escalation to human staff when requested by the guest or when the AI detects complex requests.
2. **Guest Web Chat Interface**:
   - Persistent floating action button (FAB) with live unread badge across all `/app/stay/*` pages.
   - Glassmorphic chat drawer with distinct message bubbles for Guest (Gold), AI Assistant (Dark Bot), and Human Staff (Indigo).
   - Realtime Supabase WebSockets for instant message streaming and live typing presence.
3. **Staff App Live Guest Messaging Module**:
   - Dedicated conversation queue split by status tabs: **Active Handoffs** (`STAFF_HANDOFF`), **AI Bot Managed** (`BOT_ACTIVE`), and **Resolved** (`RESOLVED`).
   - Active chat screen with 1-tap **Claim Conversation** and **Mark Resolved** controls.
   - **AI Smart Reply Suggestions**: 3 dynamically generated contextual quick-replies based on the conversation history to accelerate staff response times.
4. **Push Notifications & Synchronization**:
   - High-priority FCM push notifications sent to Front Desk & Admin staff whenever a guest escalates to staff or sends a message while in `STAFF_HANDOFF`.
   - Realtime WebSocket channels (`supabase_realtime`) for zero-latency bidirectional updates.

---

## 2. File Index & Scope

### Files to Modify:
1. [`packages/supabase/types/index.ts`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/packages/supabase/types/index.ts):
   - Add TypeScript definitions for `guest_conversations` and `guest_chat_messages` tables.
2. [`apps/web/lib/webPush.ts`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/lib/webPush.ts):
   - Add `GUEST_CHAT` and `CHAT_HANDOFF` request types to role-based routing (`FRONT_DESK`, `ADMIN`, `MANAGER`).
3. [`apps/web/app/app/stay/layout.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/app/stay/layout.tsx) & [`StayRootClientWrapper.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/web/app/app/stay/components/StayRootClientWrapper.tsx):
   - Mount the global floating `GuestChatWidget` across all guest concierge pages.
4. [`apps/staff-app/App.tsx`](file:///c:/Users/ADMIN/Videos/qr/hotel-qr-ordering-system/apps/staff-app/App.tsx):
   - Add navigation tab/section for `GuestChatModule` with live unread badge counter.
   - Wire incoming chat push notification handlers.

### New Files to Create:
1. **Database Migration**:
   - `packages/supabase/migrations/27_guest_staff_hybrid_ai_chat.sql`
2. **Backend & AI Engine (`apps/web`)**:
   - `apps/web/lib/ai-assistant.ts`: Gemini API integration with hotel knowledge base, prompt templates, and fallback rule engine.
   - `apps/web/app/api/chat/send/route.ts`: Core message ingestion, AI auto-reply trigger, and FCM push dispatcher.
   - `apps/web/app/api/chat/ai-smart-replies/route.ts`: Endpoint generating 3 contextual quick-replies for staff.
   - `apps/web/app/api/chat/handoff/route.ts`: Endpoint for escalating conversations to human staff.
   - `apps/web/app/api/chat/resolve/route.ts`: Endpoint for staff to mark conversations as resolved.
3. **Guest Web Components (`apps/web`)**:
   - `apps/web/app/app/stay/components/GuestChatWidget.tsx`: FAB, glassmorphic modal, message list, typing indicator, and quick-prompt chips.
4. **Staff App Components (`apps/staff-app`)**:
   - `apps/staff-app/components/GuestChatModule.tsx`: Conversation queue tabs (Active / Bot / Resolved), room cards, search, and unread counts.
   - `apps/staff-app/components/ActiveChatScreen.tsx`: Full-screen staff chat view, message bubbles, AI smart reply chips, claim/resolve actions, and typing indicator.

### Dependencies/Packages:
- **`apps/web`**: Standard Next.js + `@google/genai` (or native fetch to Gemini REST API) + `@hotel-qr/supabase`. No breaking native dependencies.
- **`apps/staff-app`**: Pure React Native TypeScript components (uses existing `@supabase/supabase-js`, `expo-notifications`, and `AsyncStorage`). **100% OTA-Safe**.

---

## 3. Step-by-Step Execution Checklist

### Phase 1: Database & Type System
- [x] Task 1.1: Create SQL migration `packages/supabase/migrations/27_guest_staff_hybrid_ai_chat.sql` containing:
  - `guest_conversations` table (`id`, `hotel_id`, `room_id`, `status`, `assigned_staff_id`, `guest_name`, `unread_guest_count`, `unread_staff_count`, `last_message_text`, `last_message_sender`, `last_message_at`, `created_at`, `updated_at`).
  - `guest_chat_messages` table (`id`, `conversation_id`, `hotel_id`, `room_id`, `sender_type`, `sender_staff_id`, `sender_name`, `message_text`, `is_read`, `created_at`).
  - Status constraints: `BOT_ACTIVE`, `STAFF_HANDOFF`, `RESOLVED`.
  - Sender constraints: `GUEST`, `AI`, `STAFF`, `SYSTEM`.
  - RLS policies and Realtime publication (`supabase_realtime` publication addition).
- [x] Task 1.2: Export updated TypeScript database types in `packages/supabase/types/index.ts`.

### Phase 2: AI Engine & Backend Endpoints
- [x] Task 2.1: Build `apps/web/lib/ai-assistant.ts`:
  - System prompt containing hotel identity, policies, dining hours, spa services, and standard concierge responses.
  - Integration with Gemini 2.5/3.0 Flash via REST API with fallback to built-in hotel FAQ rules.
  - Escalation intent classifier (detects requests for human staff, complaints, or custom booking needs).
- [x] Task 2.2: Implement `apps/web/app/api/chat/send/route.ts`:
  - Ingests messages, writes to `guest_chat_messages`, updates `guest_conversations`.
  - If `status === 'BOT_ACTIVE'`, immediately runs AI Assistant and inserts AI response.
  - If `status === 'STAFF_HANDOFF'`, dispatches FCM push notification via `sendWebPushToHotelStaff`.
- [x] Task 2.3: Implement `apps/web/app/api/chat/ai-smart-replies/route.ts`:
  - Accepts `conversation_id`, fetches last 6 messages, prompts Gemini for 3 short staff reply suggestions, and returns JSON array.
- [x] Task 2.4: Implement `apps/web/app/api/chat/handoff/route.ts` & `/resolve/route.ts`.
- [x] Task 2.5: Update `apps/web/lib/webPush.ts` to route `CHAT_HANDOFF` notifications to `FRONT_DESK` and `ADMIN`.

### Phase 3: Guest Web Chat Widget (`apps/web`)
- [x] Task 3.1: Create `apps/web/app/app/stay/components/GuestChatWidget.tsx`:
  - Persistent bottom-right FAB with unread badge counter.
  - Expandable glassmorphic chat container.
  - Header with dynamic state: *"🤖 AI Concierge"* vs *"🧑💼 Front Desk Staff"*.
  - Message bubble list with distinct Guest (Gold), AI (Dark), and Staff (Indigo) styling.
  - Realtime typing indicator via Supabase broadcast.
  - Quick action chips for common queries and *"Speak to Staff"* escalation button.
- [x] Task 3.2: Wire `GuestChatWidget` into `StayRootClientWrapper.tsx` so all stay subroutes render the chat.

### Phase 4: Staff App Messaging Module (`apps/staff-app`)
- [x] Task 4.1: Create `apps/staff-app/components/GuestChatModule.tsx`:
  - Queue list with tabs: **Active Handoffs**, **AI Bot Managed**, and **Resolved**.
  - Room cards with unread badges, booker/guest name, snippet, and elapsed timestamp.
  - Supabase Realtime subscription on `guest_conversations`.
- [x] Task 4.2: Create `apps/staff-app/components/ActiveChatScreen.tsx`:
  - Full-screen staff chat view with real-time message stream.
  - AI Smart Reply generator bar: 3 quick-reply chips that populate input on tap.
  - **Claim Conversation** and **Mark Resolved** header actions.
  - Realtime typing presence broadcaster.
- [x] Task 4.3: Integrate `GuestChatModule` into `apps/staff-app/App.tsx`:
  - Add Chat tab in staff navigation bar with live unread badge count.
  - Wire push notification click routing to open active conversation directly.

### Phase 5: Testing, Validation & Documentation
- [x] Task 5.1: Run TypeScript type checks on both `apps/web` and `apps/staff-app`.
- [x] Task 5.2: Verify bi-directional message delivery, AI responses, smart replies, and handoffs.
- [x] Task 5.3: Document architectural decisions in `chat-history/` and update `README.md`.

---

## 4. Edge Cases & Safety Checks

1. **AI Hallucination & Pricing Safety**:
   - AI system prompt strictly instructs the bot to state exact policies from the hotel database and avoid guaranteeing unauthorized discounts or room upgrades without staff approval.
2. **Escalation Loop Prevention**:
   - When a guest clicks "Connect to Human Staff", conversation status immediately locks to `STAFF_HANDOFF` and AI auto-replies are disabled until staff resolves the conversation.
3. **Offline & Realtime Channel Reconnect**:
   - Realtime WebSocket listeners in both apps include auto-reconnect fallback polling (every 8s) to prevent missed messages if mobile connectivity drops.
4. **Push Notification Deduplication**:
   - Staff push notifications are throttled so staff devices aren't flooded with duplicate alerts for rapid guest messages within the same minute.
5. **Database CHECK Constraints & Multi-Tenancy**:
   - All queries and mutations strictly filter by `hotel_id` and `room_id`.
   - Migration ensures strict `CHECK` constraints on `status` and `sender_type`.

---

## 5. Verification & Testing Steps

1. **Database Migration Verification**:
   - Run SQL script in Supabase SQL editor or local migration runner and verify table creation, indexes, and RLS policies.
2. **Type Check Verification**:
   ```bash
   npx -p typescript tsc --noEmit -p apps/web/tsconfig.json
   npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json
   ```
3. **Guest AI Flow Test**:
   - Open guest stay portal (`/app/stay?room=...&hash=...`), open chat widget, ask: *"What time is breakfast?"*
   - Verify instant AI response formatted with bot badge.
4. **Staff Escalation Flow Test**:
   - In guest chat, tap *"Connect to Human Staff"*.
   - Verify conversation status updates to `STAFF_HANDOFF`.
   - Verify Android Staff App receives high-priority notification and conversation appears in **Active Handoffs** tab.
5. **Staff Takeover & Smart Reply Test**:
   - In Staff App, tap the active room conversation.
   - Verify 3 AI Smart Reply chips appear below the message stream.
   - Tap a smart reply chip $\rightarrow$ verify input is pre-filled $\rightarrow$ send message.
   - Verify Guest Web instantly receives staff message in Indigo bubble with staff badge.
6. **Resolution Flow Test**:
   - In Staff App, tap **"Mark Resolved"**.
   - Verify conversation moves to **Resolved** tab and guest widget resets to AI Assistant mode.
