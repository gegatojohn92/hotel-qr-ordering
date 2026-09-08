# Bug Diagnosis & Fix Plan

---

## Issue 1 — Previous Guest Chat History Leaks Across Sessions

### 1. Root Cause Analysis

- **Trigger:** A new guest scans the room QR code, opens the chatbot, and sees the previous guest conversation history.
- **Faulty Code Path:**

  **`GuestChatWidget.tsx` → `loadConversation()` (lines 195-261)**

  The function tries two queries in sequence:
  1. **Path A (session-scoped):** Queries `guest_conversations` filtered by `session_id`. Correct isolation path.
  2. **Path B (room fallback):** If Path A returns nothing, falls back to querying any non-resolved conversation for the room — with NO session filter.

  **`PhoneCaptureModal.tsx` → `handleSubmit()` (lines 55-103)**

  When a new guest fills in the phone form it inserts into `guest_sessions` and calls `storeGuestSessionId()`. But the `guest_conversations` table does NOT yet have `session_id` / `guest_phone` columns in live DB (migration 28 not applied). So `eq('session_id', activeSessionId)` silently returns zero rows. Path B fires and loads the old conversation.

  **`send/route.ts` — Step 1b (lines 54-68)**

  Same issue on backend: Step 1b finds any active conversation for the room and reattaches the new guest's messages to the old row instead of creating a fresh one.

- **Why it failed:**
  1. **DB columns missing:** `session_id` and `guest_phone` are NULL on all rows (migration 28 not applied to live DB), so the session-scoped query always returns nothing.
  2. **Fallback is too broad:** Both frontend and backend fall back to a room-wide query picking up the previous guest's conversation.
  3. **No session boundary enforcement:** No logic ignores or resolves the old conversation when a new guest session starts.

---

### 2. Proposed Fix

**Files to Modify:**

| File | Lines / Function | Change |
|---|---|---|
| `apps/web/app/app/stay/components/GuestChatWidget.tsx` | `loadConversation()` L195-261 | Guard room fallback: only run if `activeSessionId` is null/empty. When session ID exists but returns no match, return empty and let backend create a fresh conversation. |
| `apps/web/app/app/stay/components/PhoneCaptureModal.tsx` | `handleSubmit()` L68-95 | Add `crypto.randomUUID()` client-side fallback so `session_id` is always stored in `sessionStorage` even if the `guest_sessions` DB insert fails. |
| `apps/web/app/api/chat/send/route.ts` | Step 1b fallback L54-68 | When `session_id` is present but no session-scoped conversation is found, skip room-wide fallback and always create a new conversation. |
| `packages/supabase/migrations/28_add_guest_phone_session_id.sql` | Entire file | Must be manually applied in Supabase SQL Editor — prerequisite for all session isolation to work. |

**Fix Strategy:**

- **Fix A — `GuestChatWidget.tsx`:** Wrap the Path B block: `if (!activeSessionId && !conv) { /* room fallback */ }` — only runs when no session ID exists.
- **Fix B — `PhoneCaptureModal.tsx`:** After `guest_sessions` insert try/catch, add: `if (!createdSessionId) { createdSessionId = crypto.randomUUID(); storeGuestSessionId(roomId, createdSessionId); }`
- **Fix C — `send/route.ts`:** Wrap Step 1b in `if (!session_id)` so it is skipped when session ID is provided.
- **Fix D — Migration:** Apply in Supabase SQL Editor: `ALTER TABLE guest_conversations ADD COLUMN IF NOT EXISTS session_id TEXT; ADD COLUMN IF NOT EXISTS guest_phone TEXT;`

**Regression Risks:** Low. Fallback only removed when `session_id` is present — preserves existing behavior for older clients.

---

## Issue 2 — GuestChatModule Placed Too High in Staff App Layout

### 1. Root Cause Analysis

- **Trigger:** Staff open the dashboard and see the Guest Chat widget crowding the layout between active request queues, above Request History and Logs.
- **Faulty Code Path:** `apps/staff-app/App.tsx` lines **1545-1552**.

  Current render order:
  1. Call Queue / Callback / Spa / Task modules
  2. Function Room Booking
  3. **GuestChatModule** (position 5 — too high)
  4. Food Orders Queue
  5. Request History / Logs

- **Why it failed:** GuestChatModule was inserted mid-dashboard during a feature addition and was never repositioned.

---

### 2. Proposed Fix

**Files to Modify:**

| File | Lines | Change |
|---|---|---|
| `apps/staff-app/App.tsx` | L1542-1558 | Move `<GuestChatModule />` block to after `<RequestHistory />` — last module in scroll view. |

**New render order:**
1. Call Queue / Callback / Spa / Task modules
2. Function Room Booking
3. Food Orders Queue
4. Request History / Logs
5. **GuestChatModule** (bottom)

**Regression Risks:** None. Pure JSX reorder, no logic or data dependencies.

---

## 3. Verification Checklist

- [ ] Task 1: Apply migration 28 SQL in Supabase SQL Editor (session_id, guest_phone columns).
- [ ] Task 2: Fix `GuestChatWidget.tsx` loadConversation() — guard room fallback behind !activeSessionId.
- [ ] Task 3: Fix `PhoneCaptureModal.tsx` — add crypto.randomUUID() fallback for session ID.
- [ ] Task 4: Fix `send/route.ts` — skip Step 1b room-wide lookup when session_id is provided.
- [ ] Task 5: Move GuestChatModule to bottom of dashboard in App.tsx (after RequestHistory).
- [ ] Task 6: Run TypeScript check on both apps.
- [ ] Task 7: Verify new guest QR scan shows empty chat (no old history visible).
- [ ] Task 8: Publish EAS OTA update with staff app layout change.
