# Feature Blueprint: Smart Push Suppression & Notification Settings Centre

## 1. System Overview & Objectives

### Problem Statement
Staff members using the Android app currently receive an FCM push notification for **every** guest message — even while they are actively reading or typing a reply inside `ActiveChatScreen`. This is functionally redundant and creates notification fatigue. There is also no granular, per-staff or per-hotel control over *how* these notifications behave (e.g., delay when active, mute entirely, set quiet hours, cap frequency).

### What We Are Building
Two complementary sub-systems:

| Sub-system | Scope | Where |
|---|---|---|
| **A. Staff Presence & Push Suppression** | Suppress FCM when staff are actively viewing a conversation | Supabase table + webPush.ts server logic |
| **B. Notification Settings Centre** | Granular toggles for push behaviour per staff member and hotel | New DB columns + Admin Web UI + Staff App Settings screen |

### Fit into Existing Architecture

```
Guest Web -> /api/chat/send -> webPush.ts ──► Expo FCM ──► Staff App
                                  |
                          [NEW] Presence check
                          [NEW] Per-staff prefs check
                          [NEW] Cooldown / suppression logic
```

- **webPush.ts** is the single gatekeeping point for all FCM dispatches.
- **notification_settings** (existing DB table) is extended with new hotel-wide behaviour columns.
- **staff_users** (existing table) gains per-staff preference columns (opt-out, quiet hours).
- **staff_presence** is a new lightweight table — chosen because the project has no Redis infra; Supabase Realtime already handles sub-second updates.

---

## 2. File Index & Scope

### Files to Modify

1. apps/web/lib/webPush.ts
   - Add presence-check logic before FCM dispatch
   - Add per-staff preference evaluation (quiet hours, mute, cooldown)
   - Add hotel-wide settings evaluation (suppress_if_active, push_cooldown_seconds)

2. apps/web/app/admin/settings/page.tsx
   - Add "Notification Behaviour" section with new toggles for hotel-level settings

3. apps/staff-app/components/ActiveChatScreen.tsx
   - Upsert staff_presence row on mount (set is_active_in_conversation = true, active_conversation_id)
   - Clear presence on unmount / navigate away

4. apps/staff-app/components/GuestChatModule.tsx
   - Clear presence row when staff closes ActiveChatScreen and returns to list

5. packages/supabase/types/index.ts
   - Add StaffPresence interface
   - Extend NotificationSettings with new columns
   - Add optional per-staff preference fields to StaffUser

### New Files to Create

1. packages/supabase/migrations/29_push_suppression_and_prefs.sql [NEW]
2. apps/staff-app/screens/NotificationSettingsScreen.tsx [NEW]
3. apps/staff-app/hooks/useStaffPresence.ts [NEW]

### Dependencies / Packages
- Zero new packages — pure Supabase + React Native + TypeScript
- 100% OTA-safe: All changes are logic-only; no native modules added

---

## 3. Technical Design

### 3.1 Database Schema — staff_presence table

```sql
CREATE TABLE IF NOT EXISTS public.staff_presence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL UNIQUE REFERENCES public.staff_users(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  is_active_in_conversation BOOLEAN NOT NULL DEFAULT false,
  active_conversation_id    UUID REFERENCES public.guest_conversations(id) ON DELETE SET NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_presence_conversation
  ON staff_presence(active_conversation_id)
  WHERE is_active_in_conversation = true;
```

Staleness Guard: Any presence row older than 90 seconds is treated as stale and the push is sent anyway (guards against app crash or network drop without cleanup).

---

### 3.2 New Columns on notification_settings

```sql
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS suppress_if_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_cooldown_seconds INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_from INT NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS quiet_hours_to   INT NOT NULL DEFAULT 7;
```

---

### 3.3 New Columns on staff_users

```sql
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS mute_guest_chat_push BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppress_push_when_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_hours_from_override INT,
  ADD COLUMN IF NOT EXISTS quiet_hours_to_override   INT;
```

---

### 3.4 New Column on guest_conversations (cooldown tracking)

```sql
ALTER TABLE guest_conversations
  ADD COLUMN IF NOT EXISTS last_push_sent_at TIMESTAMPTZ;
```

---

### 3.5 Push Suppression Decision Tree in webPush.ts

For each staff member in the filtered staffData list:

```
1. Is staff_users.mute_guest_chat_push = true?
   -> SKIP (fully muted for this staff member)

2. Is requestType in [GUEST_CHAT, CHAT_HANDOFF]?
   -> NO: send normally (non-chat types bypass all chat suppression)

3. [Hotel] suppress_if_active = true AND [Staff] suppress_push_when_active = true?
   -> Query staff_presence WHERE staff_user_id = staff.id
        AND active_conversation_id = payload.conversationId
        AND is_active_in_conversation = true
        AND last_seen_at > NOW() - INTERVAL '90 seconds'
   -> Match found? -> SUPPRESS for this staff member

4. CHAT_HANDOFF bypasses cooldown (escalations always send).
   For GUEST_CHAT only: [Hotel] push_cooldown_seconds > 0?
   -> Query guest_conversations.last_push_sent_at
   -> Within cooldown window? -> SUPPRESS

5. [Hotel] quiet_hours_enabled = true?
   -> Get Manila hour. Check staff override, then hotel setting.
   -> In quiet window? -> SUPPRESS

6. -> SEND
```

After a successful batch send: update guest_conversations.last_push_sent_at = NOW().

---

### 3.6 useStaffPresence Hook

```typescript
// apps/staff-app/hooks/useStaffPresence.ts
export function useStaffPresence(staffUserId: string, conversationId: string | null) {
  useEffect(() => {
    if (!staffUserId || !conversationId) return

    supabase.from('staff_presence').upsert({
      staff_user_id: staffUserId,
      hotel_id: HOTEL_ID,
      is_active_in_conversation: true,
      active_conversation_id: conversationId,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'staff_user_id' })

    const heartbeat = setInterval(() => {
      supabase.from('staff_presence').update({
        last_seen_at: new Date().toISOString(),
      }).eq('staff_user_id', staffUserId)
    }, 30_000)

    return () => {
      clearInterval(heartbeat)
      supabase.from('staff_presence').update({
        is_active_in_conversation: false,
        active_conversation_id: null,
        updated_at: new Date().toISOString(),
      }).eq('staff_user_id', staffUserId)
    }
  }, [staffUserId, conversationId])
}
```

---

### 3.7 NotificationSettingsScreen (Staff App)

A new screen accessible from the Staff App header/profile menu:

| Setting | Type | Default | Description |
|---|---|---|---|
| Mute All Guest Chat Pushes | Toggle | OFF | Completely stop guest chat FCM for this account |
| Suppress While Viewing Chat | Toggle | ON | Hold push if already in that conversation |
| Personal Quiet Hours | Toggle + Time pickers | OFF | Override hotel quiet hours for this account |

Reads and writes staff_users columns via Supabase for the authenticated staff user only.

---

### 3.8 Admin Settings — Hotel-Level Push Behaviour (Web)

New "Push Notification Behaviour" section in admin/settings/page.tsx:

| Setting | Type | Default |
|---|---|---|
| Suppress push if staff is actively viewing that chat | Toggle | ON |
| Minimum seconds between pushes per conversation (cooldown) | Number input 0-300 | 30 |
| Enable Hotel-Wide Quiet Hours | Toggle | OFF |
| Quiet Hours: From (0-23) | Number input | 22 |
| Quiet Hours: To (0-23) | Number input | 7 |

---

## 4. Step-by-Step Execution Checklist

### Phase 1: Database Migration
- [x] 1.1 Create packages/supabase/migrations/29_push_suppression_and_prefs.sql:
  - Create staff_presence table with RLS (public read for service role, staff update own row)
  - ALTER TABLE notification_settings — add 5 new columns with defaults
  - ALTER TABLE staff_users — add 4 preference columns with defaults
  - ALTER TABLE guest_conversations — add last_push_sent_at TIMESTAMPTZ
  - Seed default hotel: suppress_if_active=true, push_cooldown_seconds=30
- [x] 1.2 Update packages/supabase/types/index.ts:
  - Add StaffPresence interface
  - Extend NotificationSettings interface with new columns
  - Add preference columns to StaffUser interface
  - Add last_push_sent_at to GuestConversation

### Phase 2: Push Suppression Engine (webPush.ts)
- [x] 2.1 After role-based filtering, add per-staff mute check (skip muted staff)
- [x] 2.2 Add presence-check suppression for GUEST_CHAT and CHAT_HANDOFF types
- [x] 2.3 Add cooldown check for GUEST_CHAT type (CHAT_HANDOFF bypasses cooldown)
- [x] 2.4 Add quiet hours check using hotel settings and per-staff override
- [x] 2.5 After successful send: update guest_conversations.last_push_sent_at

### Phase 3: Staff App — Presence Reporting
- [x] 3.1 Create apps/staff-app/hooks/useStaffPresence.ts
- [x] 3.2 Integrate hook into ActiveChatScreen.tsx on mount/unmount
- [x] 3.3 Verify presence is cleared when staff navigates back to GuestChatModule list

### Phase 4: Staff App — Notification Settings Screen
- [x] 4.1 Create apps/staff-app/screens/NotificationSettingsScreen.tsx
- [x] 4.2 Add navigation entry in Staff App header or profile section

### Phase 5: Admin Web — Settings Page Enhancement
- [x] 5.1 Add "Push Notification Behaviour" section to admin/settings/page.tsx
- [x] 5.2 Wire into existing loadHotelSettings and handleSaveNotifications pattern

### Phase 6: Verification
- [x] 6.1 npx -p typescript tsc --noEmit -p apps/web/tsconfig.json
- [x] 6.2 npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json
- [x] 6.3 Manual flow tests (see Section 5)
- [x] 6.4 Git commit and push to main

---

## 5. Edge Cases & Safety Guarantees

| Scenario | Handling |
|---|---|
| Staff app crashes without cleanup | Staleness guard (90s) — push always goes through after timeout |
| Staff views conversation on two devices | Presence is per staff_user_id (UNIQUE), last write wins |
| conversationId missing from push payload | Skip presence/cooldown checks; send normally |
| staff_presence table not yet migrated | Wrap in try/catch; on error, send normally |
| notification_settings new columns not migrated | Use JS defaults (suppress_if_active: true, cooldown: 30) |
| staff_users preference columns not migrated | Treat as defaults (mute=false, suppress=true) |
| Cooldown blocks urgent CHAT_HANDOFF | CHAT_HANDOFF bypasses cooldown — only GUEST_CHAT respects it |
| Multiple staff online, only one viewing | Only the viewing staff member is suppressed; others receive push normally |

---

## 6. Verification & Testing Steps

### Test 1: Push Suppression While Viewing Chat
1. Staff opens Android app, taps into an active STAFF_HANDOFF conversation.
2. Guest sends a message from the web.
3. Expected: No FCM push notification on the staff device (they are actively viewing).
4. Staff navigates back to the chat list.
5. Guest sends another message.
6. Expected: FCM push arrives normally.

### Test 2: Cooldown Between Messages
1. Hotel settings: push_cooldown_seconds = 60.
2. Guest sends Message 1 — push arrives on staff app.
3. Guest sends Message 2 within 30 seconds — push suppressed.
4. Guest sends Message 3 after 65 seconds — push arrives.

### Test 3: Staff Mute Toggle
1. Staff opens Notification Settings screen, toggles "Mute All Guest Chat Pushes" ON.
2. Guest sends a message.
3. Expected: No push for that staff member. Other staff receive push normally.

### Test 4: Quiet Hours
1. Admin sets quiet hours 22:00–07:00.
2. Guest sends a message at 23:00 Manila time.
3. Expected: No push dispatched. Message still saved in DB.

### Test 5: Staleness Guard
1. Force-kill the staff app without navigating away from ActiveChatScreen.
2. Wait 120 seconds (over 90s staleness threshold).
3. Guest sends a message.
4. Expected: Push sent normally (stale presence ignored).

### Test 6: CHAT_HANDOFF Bypasses Cooldown
1. Set push_cooldown_seconds = 300.
2. Guest sends multiple routine messages (suppressed after first due to cooldown).
3. Guest triggers AI escalation (shouldEscalate = true) => CHAT_HANDOFF.
4. Expected: CHAT_HANDOFF push arrives immediately, bypassing the cooldown.

---

## 7. Implementation Notes

- No Redis required — presence state uses Supabase with indexed queries. At hotel scale (< 20 concurrent staff), this is fully performant.
- Heartbeat interval is 30 seconds, keeping well within the 90-second staleness window.
- OTA Safety: All changes are pure JS/TS. No native module additions. Deployable via Expo OTA without a new APK build.
- Backwards Compatibility: Every new DB column has a DEFAULT. All new DB queries in webPush.ts are wrapped in try/catch so a partial migration never breaks push delivery.
- Audit Trail: The last_push_sent_at column doubles as an audit field showing when the last push was dispatched for any conversation.
