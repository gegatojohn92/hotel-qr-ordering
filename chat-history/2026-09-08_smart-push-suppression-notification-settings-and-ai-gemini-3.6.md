# 2026-09-08: Smart Push Suppression, Notification Settings Centre & Gemini 3.6 Flash AI Engine

## Summary
Designed and implemented an intelligent FCM push suppression system and notification settings centre across the staff app and web admin. Resolved the guest AI assistant engine failure by upgrading to `gemini-3.6-flash` (following Google's deprecation of older flash models), fixing turn-taking alternation in multi-turn chats, and configuring local environment variables. Polished the staff app tablet header layout to stack actions neatly and prevent title truncation.

## Key Changes

### 1. Smart Push Suppression & Staff Presence (`apps/web` & `apps/staff-app`)
- **Problem**: Staff members received loud FCM push notifications on every guest message, even while actively reading or typing in that specific conversation inside `ActiveChatScreen`.
- **Database Schema (Migration 29 - `packages/supabase/migrations/29_push_suppression_and_prefs.sql`)**:
  - Created `public.staff_presence` table with `staff_user_id`, `hotel_id`, `is_active_in_conversation`, `active_conversation_id`, and `last_seen_at` heartbeat.
  - Added hotel-wide columns to `notification_settings`: `suppress_if_active`, `push_cooldown_seconds`, `quiet_hours_enabled`, `quiet_hours_from`, `quiet_hours_to`.
  - Added per-staff preference columns to `staff_users`: `mute_guest_chat_push`, `suppress_push_when_active`, `quiet_hours_from_override`, `quiet_hours_to_override`.
  - Added `last_push_sent_at` column to `guest_conversations` for cooldown tracking.
- **Presence Reporting Hook (`apps/staff-app/hooks/useStaffPresence.ts`)**:
  - Upserts presence on entering `ActiveChatScreen`, runs a 30s heartbeat, and cleans up state on unmount or returning to conversation list.
- **Push Suppression Gatekeeper (`apps/web/lib/webPush.ts`)**:
  - Checks if staff member has muted guest chat pushes.
  - Checks real-time presence: suppresses FCM push if the staff member is actively viewing that specific room's conversation with a fresh heartbeat (< 90s staleness guard).
  - Enforces conversation cooldown window (`push_cooldown_seconds`) on rapid-fire guest messages (urgent `CHAT_HANDOFF` escalations bypass cooldown).
  - Enforces hotel-wide and personal quiet hours (Manila Time).

### 2. Notification Settings Screen & Admin Centre
- **Staff App Screen (`apps/staff-app/screens/NotificationSettingsScreen.tsx`)**:
  - Personal toggles for: Mute All Guest Chat Pushes, Suppress While Viewing Chat, and Personal Quiet Hours with custom From/To hours.
  - Opened via full-screen modal from the staff tablet header.
- **Web Admin Settings (`apps/web/app/admin/settings/page.tsx`)**:
  - Added **🔕 Smart Push Suppression & Cooldown** section in Hotel Settings.
  - Hotel-level controls for active chat suppression, cooldown slider (0-180s), and hotel-wide quiet hours.

### 3. AI Concierge Engine & Gemini 3.6 Flash Upgrade (`apps/web`)
- **Model Upgrade**: Google deprecated `gemini-2.0-flash` and `gemini-1.5-flash` for new API keys (returning 404). Upgraded default primary model to **`gemini-3.6-flash`** with configurable fallback list.
- **Turn Alternation Bug Fix (`/api/chat/send/route.ts`)**:
  - Excluded the newly inserted guest message (`.neq('id', guestMsg.id)`) from prior history queries to eliminate duplicate consecutive `user` turns that triggered Google 400 errors.
- **Turn Sanitizer (`apps/web/lib/ai-assistant.ts`)**:
  - Sanitized multi-turn conversations to ensure strictly alternating turns starting with `user`, multi-part merging for consecutive same-role turns, and deduplication.
  - Added detailed error diagnostics logging.
- **Environment Configuration**:
  - Added `.env.local` with `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.6-flash`.
  - Live tested with real queries — verified `Status: 200 OK` responses with sub-second generation.

### 4. Staff App Header Layout Polish (`apps/staff-app/App.tsx`)
- **Problem**: Horizontal placement of `🔔 Alerts`, `⚡ Sync`, and `↩ Logout` crowded out the "Front Desk" and "Tablet Interface" header text.
- **Fix**:
  - Vertically stacked `⚡ Sync` and `🔔 Alerts` in a dedicated action column with balanced padding.
  - Added `flexShrink: 0` to actions container and `flex: 1` with `marginRight: 8` to `headerMeta`.
  - Reclaimed over 110px of horizontal space, ensuring titles never stretch or wrap awkwardly.

## Verification
- `apps/web`: TypeScript typecheck passed (`tsc --noEmit`, exit code 0).
- `apps/staff-app`: TypeScript typecheck passed (`tsc --noEmit`, exit code 0).
- Live Gemini 3.6 Flash query verified with stay context (Room 402, late check-out rates, smart replies).
