# Agent Handoff — Hotel QR Ordering System

Summary of recent changes implemented by the agent (staff-app focus)

This document records the edits, fixes, and feature work performed during the current session. It is intended to help a human developer pick up where the agent left off.
 tepmp": database pass: johngegato12
---

## ⚠️ Deploy Reminder — OTA Update vs. APK Rebuild

After every change, the agent (or developer) **must** assess whether deploying requires an OTA push or a full Android rebuild.

### ✅ OTA Update Only — `npx eas-cli update --branch preview --message "..."`
Run from `apps/staff-app/`. No APK reinstall required on staff devices.
| Change Type | Examples |
| :--- | :--- |
| **TypeScript / React Native code** | Bug fixes, UI logic, component state, hooks |
| **New screens or UI components** | New queues, modals, cards, buttons |
| **Styling & layout** | Colors, spacing, fonts, animations |
| **Supabase queries & API calls** | Filters, inserts, realtime subscriptions |
| **Notification logic** | Routing rules, deduplication, alert timing |
| **Business logic** | RBAC checks, order calculations, validations |

### 🔴 Full APK Rebuild Required — `eas build -p android --profile preview`
Native configuration changes that require Gradle compilation and a new `.apk`.
| Change Type | Examples |
| :--- | :--- |
| **New native Android permissions** | Added to `"permissions"` in `app.json` |
| **New native Expo plugins** | Added to `"plugins"` array in `app.json` (e.g. `expo-av`, `expo-updates`) |
| **New packages with native code** | Java, Kotlin, C++ bindings (e.g. `react-native-mmkv`, new Firebase SDKs) |
| **Changes to `google-services.json`** | Firebase config update |
| **Android `versionCode` / `versionName` bump** | Major release |
| **`runtimeVersion` policy change** | Alters OTA compatibility window |

> [!IMPORTANT]
> The current build is on EAS project `johngegato/hotel-staff-app` (ID: `4e2f24d0-60e3-4ce3-891e-1f2a1e591df6`).  
> Branch in use: **`backup-8-31-26-4pm`** — do **NOT** commit or push to `main` until testing is complete.

---

Key goals
- Merge backup into repo (prefer repo files on conflicts).
- Fix spa booking flows: ensure staff manual bookings create `spa_slot_locks` and the master timetable shows guest bookings created on other days.
- Add `spa_slot_locks` insert on manual bookings and seed `DEFAULT_ROOM_ID`.
- Add pre-approval editing UI and a Call action in staff-app Spa Queue.
- Fix Expo/TS/web build issues (typed catches, haptics on web, undefined imports).
- Fix food order realtime queue sync in staff-app on alert acknowledgment and DB changes.
- Fix actor attribution bug in RequestHistory showing guest names with STAFF role badge.
- Add admin toggle to hide/show the guest web Live Voice Call button (`notification_settings.enable_guest_live_call`, migration 23; admin settings switch; `CallFrontDeskModal.tsx` gating). ⚠️ Migration 23 must be applied manually on hosted Supabase.
- Fix staff-app "Call Failed" on answering live voice calls: token fetch now uses absolute `https://hotel-qr-ordering-system-web.vercel.app` base (native can't use relative URLs) and `react-native-agora` v4 `joinChannel(token, channelId, uid, options)` signature with `onJoinChannelSuccess`/`onError` handlers. Deploy via OTA.
- Build Dynamic Theme & Content CMS (migration 24): `theme_mode`, `theme_config`, `content_config` columns on `hotels`, admin branding page at `/admin/branding` with 4 tabs (Visual Theme, Welcome & Landing, Sections & Modules, Live Preview), guest web provider with realtime sync and WCAG contrast checks.
- Fix guest web QR access crash: split room validation from theme fetch so missing migration 24 columns don't show "Invalid QR Code" error — graceful fallback to DARK_GOLD defaults.
- **PENDING**: Supabase account migration — current project (`bsjnlawhdgfilcfejbji.supabase.co`) has exhausted egress limits. Guide in `chat-history/2026-09-04_supabase-account-migration-guide.md`. Migrations 23 + 24 not yet applied to production.

- **Guest Chat FCM Push Notification Link & Alarm Execution (2026-09-08)**:
  - **Problem**: When guests submitted messages in the guest web chat, staff devices running the Android staff-app were not receiving push notifications or audible alarms.
  - **Root Cause Analysis**:
    1. `apps/web/app/api/chat/send/route.ts`: During `BOT_ACTIVE` mode, push notifications were strictly gated behind `if (aiResponse.shouldEscalate)`. Regular guest messages never triggered any push notification to staff.
    2. `apps/staff-app/lib/notifications.ts`: The client-side `canRoleReceiveNotification` filter for `FRONT_DESK` was missing `CHAT_HANDOFF` and `GUEST_CHAT`, causing local notification filtering to silently drop chat alerts.
    3. `apps/staff-app/App.tsx`: The push response handler caught `CHAT_HANDOFF` and `GUEST_CHAT` and called `setRefreshKey` followed by an immediate `return`, failing to invoke `triggerAlarmNotification()`. Staff received no sound or vibration heads-up notification. In addition, foreground push reception lacked a refresh handler for incoming chat notifications.
  - **Resolution**:
    - `apps/web/app/api/chat/send/route.ts`: Updated to dispatch high-priority `GUEST_CHAT` pushes for all messages in `BOT_ACTIVE` mode so staff stay informed. Escalation continues to dispatch high-priority `CHAT_HANDOFF` alerts. Reused single `roomNumber` lookup to optimize database queries.
    - `apps/staff-app/lib/notifications.ts`: Added `CHAT_HANDOFF` and `GUEST_CHAT` to the `FRONT_DESK` role permissions in `canRoleReceiveNotification`, matching server-side routing in `webPush.ts`.
    - `apps/staff-app/App.tsx`: Added `triggerAlarmNotification()` on push response for chat events, ensuring staff get audible/vibrating heads-up alerts. Added `setRefreshKey` in `addNotificationReceivedListener` so foregrounded apps immediately update the chat list when a push arrives.
- **Enhanced AI Concierge Knowledge Base & Dynamic Manila Time Context (2026-09-08)**:
  - Updated `apps/web/lib/ai-assistant.ts` with comprehensive hotel details including all room types and rates (Standard, Deluxe, Suite, Executive, Family Suite, Penthouse), complete spa service menu (Swedish, Deep Tissue, Hot Stone, Aromatherapy, Shiatsu, Foot Reflexology), dry sauna operating hours (6:00 AM – 10:00 PM, ₱350/session or free for Suite/Penthouse), and Front Desk contact details.
  - Added dynamic context injection passing room number, guest name, guest phone, formatted Manila local time (`Asia/Manila`), and 24-hour hour integer into `generateAiResponse()`.
  - Added 18 rich fallback rules with regex triggers for spa prices, sauna, check-in/out, WiFi, breakfast, and front desk assistance.
  - Implemented bold markdown rendering (`**text**`) in `apps/web/app/app/stay/components/GuestChatWidget.tsx` and updated quick prompts from pool to sauna hours.
- **Guest Chat Session Isolation & Privacy Enforcement (2026-09-08)**:
  - **Problem**: Previously, guest chat conversations had fallback queries searching by `room_id` alone. When a new guest scanned the room's QR code on their phone, the chat drawer loaded the previous guest's conversation history, messages, and requests.
  - **Resolution**:
    - **Database Migrations (`packages/supabase/migrations/28_add_guest_phone_session_id.sql` & `28_guest_chat_session_and_phone.sql`)**: Added `session_id` and `guest_phone` columns to `guest_conversations` table with performance indexes.
    - **Purged Room-Level Fallback Queries (`apps/web/app/app/stay/components/GuestChatWidget.tsx`)**: Removed the room-wide query fallback from `loadConversation()`. Conversations are strictly loaded by matching the active guest session (`storedConvId` or `activeSessionId` in `sessionStorage`). If no match, state defaults to clean (`conversation = null`, `messages = []`), ensuring new guests see a clean welcome screen with zero leaked messages.
    - **Backend Conversation Isolation (`apps/web/app/api/chat/send/route.ts`)**: Removed Step 1b room-level conversation recycling. When a message is sent without an existing conversation ID or session match, a brand-new conversation is always created.
    - **Immediate Client Session Lifecycle (`PhoneCaptureModal.tsx` & `GuestSessionKeeper.tsx`)**: Implemented `getOrCreateGuestSessionId` and `generateClientSessionId` to ensure a UUID is stored in `sessionStorage` upon page visit, and `storeGuestConversationId` to lock the active conversation to the guest's tab.
    - **Staff App UI Reorganization (`apps/staff-app/App.tsx`)**: Repositioned `<GuestChatModule />` to the bottom of the dashboard layout (below Request History & Logs) to keep operational queues clean and uncluttered.
    - **Staff Active Chat Direct Dialing (`apps/staff-app/components/ActiveChatScreen.tsx`)**: Displays guest phone number beside room number in header with 1-tap direct dialing (`tel:`) support.
    - **AI Assistant Policies Update (`apps/web/lib/ai-assistant.ts`)**: Updated hotel policies for check-in/out charges, WiFi password locations, housekeeping schedules, and complimentary amenities.
- 2-Way Live Voice Calling between Guest Web and Staff App (Agora RTC):
  - Database (Migration 21): Added `agora_channel` column to `requests` table in `packages/supabase/migrations/21_live_call_channel.sql` & `apps/web/supabase/migrations/21_live_call_channel.sql`.
  - Server Token API (`apps/web/app/api/agora/token/route.ts` [NEW]): Generates 24-hour signed RTC tokens using `agora-access-token` server-side with `AGORA_APP_CERTIFICATE`.
  - Guest Web Client (`apps/web/app/app/stay/components/`):
    - `GuestVoiceCallEngine.tsx` [NEW]: Dynamic browser Agora client handling mic stream publication (UID=1) and staff audio subscription.
    - `CallFrontDeskModal.tsx`: Added "Live Voice Call" CTA with connecting, in-call (mute toggle + end call), and ended states.
  - Staff App (`apps/staff-app/`):
    - `app.json`: Added `react-native-agora` plugin and Bluetooth permissions (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH`, `BLUETOOTH_CONNECT`).
    - `lib/useStaffVoiceCall.ts` [NEW]: React Native Agora RTC engine hook (UID=2) integrating `react-native-incall-manager` for speaker and proximity routing.
    - `components/IncomingLiveCallAlert.tsx` [NEW]: Full-screen animated answer/decline overlay with pulsing phone and 45s auto-dismiss timer.
    - `components/ActiveCallBar.tsx` [NEW]: Floating live call bar with timer, mute/speaker toggles, and end call button.
    - `App.tsx`: Realtime `LIVE_CALL` event routing, notification handlers, and full call lifecycle integration.
  - Webhook & Push Routing (`apps/web/app/api/push/webhook/route.ts` & `apps/web/lib/webPush.ts`):
    - Added `LIVE_CALL` high-priority notification routing with `agoraChannel` data forwarding for backgrounded staff wake-ups.
- Over-The-Air (OTA) Auto-Updates via `expo-updates` (`apps/staff-app`):
  - `app.json`: Configured `"runtimeVersion": { "policy": "appVersion" }`, `"updates": { "url": "https://u.expo.dev/4e2f24d0-60e3-4ce3-891e-1f2a1e591df6", "checkAutomatically": "ON_LOAD", "fallbackToCacheTimeout": 0 }`, and added `"expo-updates"` to plugins.
  - `apps/staff-app/lib/useAutoUpdate.ts` [NEW]: Custom hook checking `Updates.checkForUpdateAsync()` on app launch and foreground resume (`AppState === 'active'`), downloading bundles silently via `Updates.fetchUpdateAsync()`, and prompting staff with a non-cancelable restart dialog that calls `Updates.reloadAsync()`.
  - `apps/staff-app/App.tsx`: Wired `useAutoUpdate()` directly at the root `MainAppContent` component.
- Database & Schema (Migration 20): Created `20_notification_settings.sql` in both `packages/supabase/migrations/` and `apps/web/supabase/migrations/`.
  - Added unique partial index `idx_staff_users_push_token_unique` on `staff_users(push_token) WHERE push_token IS NOT NULL` preventing token duplicates across multiple accounts on shared devices.
  - Created `notification_settings` table (`hotel_id`, `reminder_interval_minutes`, `enable_sound_alert`, `max_alert_duration_seconds`, `fnb_allowed_types`, `frontdesk_allowed_types`, `spa_allowed_types`) with default seed row for default hotel and RLS policies.
- Staff App Token Lifecycle Cleansing (`apps/staff-app/lib/notifications.ts` & `App.tsx`):
  - Added `bindPushTokenToStaffUser`: unlinks device token from any other accounts before assigning to current user.
  - Added `clearPushTokenFromStaffUser`: nullifies `push_token` on logout to prevent orphaned push delivery to logged-out users.
  - Wired into `handleLogout` and push registration lifecycle.
- Role-Based Notification Routing & Deduplication (`apps/staff-app/` & `apps/web/`):
  - Added `canRoleReceiveNotification` helper in `notifications.ts` and `App.tsx`.
  - Added `alertedRequestIdsRef` deduplication cache in `App.tsx` suppressing duplicate alarms for the same request ID.
  - Updated `apps/staff-app/components/IncomingRequestAlert.tsx` with `enableSound` and `maxDurationSeconds` props, auto-stopping loop and dismissing according to configured duration.
  - Updated `apps/web/lib/webPush.ts`: Added role-targeted staff filtering based on request type (`FOOD_ORDER` $\rightarrow$ F&B, `CALL_REQUEST`/`TASK` $\rightarrow$ Front Desk/Housekeeping, `SPA_BOOKING` $\rightarrow$ Spa, `ADMIN`/`MANAGER` $\rightarrow$ All).
- Automated Database Webhook Endpoint (`apps/web/app/api/push/webhook/route.ts` [NEW]):
  - Webhook route for Supabase Database Webhooks / database triggers on `requests` INSERT, resolving room number and dispatching high-priority push notifications to role-targeted staff devices.
- Admin Notification Settings Controls (`apps/web/app/admin/settings/page.tsx`):
  - Added "Staff Push & Alarm Controls" panel: reminder interval dropdown (1m, 2m, 5m, 10m, 15m, disabled), audio alarm toggle, max alarm ring duration slider (10s-120s), role routing matrix with department checkboxes, and instant test push dispatcher (`🔔 Send Test Notification`).
  - Saves to `notification_settings` and logs to `audit_logs`.
- Database & Schema (Migration 19): Added `fnb_phone_number` (TEXT) to `hotels` table in both `packages/supabase/migrations/19_fnb_phone_number.sql` and `apps/web/supabase/migrations/19_fnb_phone_number.sql`. Updated `Hotel` interface in `packages/supabase/types/index.ts`.
- apps/web/app/admin/settings/page.tsx: Added F&B Direct Phone Number field to Admin Settings with live fetching, persistent save to `hotels` table, and audit trail logging.
- apps/web/app/app/stay/components/FnBDiningFAB.tsx [NEW] & dining/page.tsx: Created persistent floating action button (FAB) for direct calling F&B with dynamic phone loading from hotel record.
- apps/staff-app/App.tsx: Role-Based Access Control (RBAC) for `KITCHEN` role — dedicated Kitchen / F&B Portal view showing only `FoodQueue` and food metrics, hiding non-dining modules, and filtering background/popup alerts strictly to `FOOD_ORDER`.
- apps/staff-app/components/FoodQueue.tsx: Implemented rich "+ Phone / Manual Order" creation modal with active room selector, guest name/phone, catalog item picker with category filters/search, +/- quantity counters, cooking instructions, live service charge calculation, and audit trail. Added universal `📞 Call Guest` button to all food cards.
- apps/staff-app/components/TaskQueue.tsx: Added universal `📞 Call Guest` button on all task cards with disabled fallback. Fixed `handleResolve` crash by removing nonexistent `updated_at` column from update payload (preventing PGRST204 errors).
- apps/staff-app/components/SpaQueue.tsx & EditSpaBookingModal.tsx: Added standardized `📞 Call Guest` buttons and headers with disabled fallbacks across all spa cards and modal banners.
- apps/staff-app/components/RequestHistory.tsx: Universal guest quick-call row on ALL request types (TASK, FOOD, SPA, CALL) with multi-tier phone resolution (`guest_phone`, `phone_number`, `phone`, `custom_notes` regex, `special_instructions` regex). Added comprehensive Task Request detail view in modal with dedicated `📞 Dial Now` action.
- apps/web/app/app/stay/requests/page.tsx: Updated guest task submission payload to explicitly save `guest_phone` as a structured field alongside `custom_notes`.
- apps/staff-app/lib/notifications.ts: Created web-safe notification engine configuring the `urgent_guest_requests` Android notification channel with `AndroidImportance.MAX`, `AndroidAudioUsage.ALARM`, custom high-intensity vibration pattern, LED light triggers, and push token registration.
- apps/staff-app/app.json: Added Android permissions (`WAKE_LOCK`, `USE_FULL_SCREEN_INTENT`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `RECEIVE_BOOT_COMPLETED`) to support APK creation and reliable background execution.
- apps/staff-app/components/PendingRequestsReminderModal.tsx [NEW]: Implemented rich recurring unhandled requests alert popup with department breakdown chips (Calls, Spa, Dining, Tasks), live waiting counters, audio chimes, and haptics.
- apps/staff-app/App.tsx: Wired 5-minute recurring checker (`checkUnhandledRequests`) on a 300,000ms timer and Realtime listener to trigger alert popup and native push notifications whenever pending requests remain unhandled.
- apps/staff-app/App.tsx & FoodQueue.tsx: Fixed stale closure in Supabase Realtime channel subscription by wrapping `fetchData` in `useCallback` with a mutable `useRef` pointer. Bushed `refreshKey` trigger on incoming request alert dismissal so food orders appear instantly without manual page refresh.
- apps/staff-app/components/RequestHistory.tsx: Fixed actor attribution in request history and audit logs. Prioritized `claimed_by` staff lookup via `staffMap` over payload's `booked_by` string (which contained guest strings like `"Guest (Room 105)"`), preventing guest strings from rendering with the STAFF role pill and icon.
- apps/staff-app/App.tsx: Cleaned up login UI (removed demo credentials box, pre-filled input defaults, Phase 4 banner, and redesigned brand header).
- apps/web/app/layout.tsx + apps/web/app/page.tsx + apps/web/app/app/stay/page.tsx: Rebranded hotel name from "Grand Hotel" to "Kekehyu Hotel" across all guest-facing web pages.
- apps/staff-app/components/CallQueue.tsx: Added `📞 Call Guest` button using `Linking.openURL('tel:...')` that dials the guest's phone number from `payload.guest_phone`. Fallback Alert shown when no phone number is on record. Added `guest_phone` to `RequestItem` interface.
- apps/staff-app/components/DedicatedCallModule.tsx: Added `📞 Call` action button in card action row. Phone number row is now a tappable green pill (`📞 +63xxx | Tap to call`) that directly fires the native dialer. Three-button action row: `📞 Call` → `✓ Claim` → `✓ Resolve`.
- apps/staff-app/components/RequestHistory.tsx: Added guest phone display to `CALL_REQUEST` history list cards — tappable green pill showing phone number that opens the native dialer. Detail modal now shows a `📞 Dial Now` button with the guest phone number. No-phone-on-record state handled gracefully with informative text and Alert.
- apps/staff-app/lib/authStorage.ts [NEW] & apps/staff-app/App.tsx: Implemented persistent auto-login session management using `@react-native-async-storage/async-storage` with `localStorage` web fallback. Automatically stores active session upon successful login, restores session on app launch/restart to bypass the login screen immediately, validates active status against Supabase in the background, and completely clears saved session upon clicking "Log Out".
- apps/staff-app/App.tsx: Fixed recurring 5-minute reminder modal loop on auto-sync ticks by adding a `lastDismissedReminderAtRef` 5-minute cooldown guard and decoupling the modal popup check from background auto-sync polling.
- apps/web/app/app/stay/spa/page.tsx: Fixed Guest Web bug where all 'Today' time slots were incorrectly marked as "passed". Standardized `parseTimeToHoursAndMinutes`, `convertDisplayTimeTo24Hour`, and `getSlotWindow` using a robust AM/PM regex parser to handle 12h/24h strings properly.
- apps/staff-app/components/ManualSpaBookingModal.tsx, SpaAvailabilityModal.tsx, EditSpaBookingModal.tsx, SpaTimetable.tsx: Fixed Staff App bug where vacant timetable slots failed to accept bookings. Removed the silent next-day auto-roll-over (`if (day === 'today' && start < Date.now()) start.setDate(+1)`) in `buildSlotWindow` across all 4 files, ensuring the explicit `day` selection is the single source of truth and resolving date mismatches between the timetable grid and created bookings.
- apps/staff-app/components/SpaTimetable.tsx & App.tsx: Excluded Spa Timetable from auto-sync polling by removing `useAutoSync` and `refreshTrigger` effect, relying solely on Supabase Realtime subscriptions to eliminate constant reloading and screen flashing.
- apps/staff-app/components/RequestHistory.tsx: Wrapped the Request History module in a collapsible accordion component (collapsed by default via `isAccordionOpen: false`) with header badge counter and toggle chevron to optimize mobile vertical scrolling.
- apps/web/supabase/migrations/16_cleanup_expired_spa_holds.sql & packages/supabase/migrations/16_cleanup_expired_spa_holds.sql [NEW]:
  - Implemented automated database cleanup system for temporary `HELD` spa locks.
  - `cleanup_expired_spa_holds()` function: automatically marks unconfirmed `HELD` locks as `EXPIRED` once `expires_at <= NOW()`, and permanently purges abandoned `HELD`/`EXPIRED` locks older than 1 hour.
  - `trg_cleanup_expired_spa_holds` trigger on `spa_slot_locks`: performs a lazy, non-blocking cleanup sweep on every new lock attempt, guaranteeing the table stays clean without requiring external cron daemons.
  - Optional `pg_cron` schedule registration (`*/10 * * * *`) when the extension is active in Supabase.
- apps/web Guest Persistent Session & Escalation Engine [NEW]:
  - `apps/web/app/app/stay/components/GuestSessionKeeper.tsx` [NEW]: Automatically records active `guest_sessions` in Supabase upon scanning QR codes, sends initial presence connection pings to staff devices, maintains realtime channel presence, and runs a recurring 1-2 minute push escalation loop for unacknowledged pending requests.
  - `apps/web/app/app/stay/components/StayRootClientWrapper.tsx` & `layout.tsx` [NEW]: Wraps all guest sub-routes (`/app/stay`, `/app/stay/dining`, `/app/stay/spa`, `/app/stay/requests`) so escalation and presence are always running globally.
  - `apps/web/app/app/stay/spa/page.tsx` & `CallFrontDeskModal.tsx`: Added instant Web Push dispatching on spa bookings and front desk call requests.
- Dynamic Theme & Content CMS (Migration 24):
  - Database: `packages/supabase/migrations/24_guest_web_theme_content_cms.sql` & `apps/web/supabase/migrations/24_guest_web_theme_content_cms.sql` — Added `theme_mode` (TEXT, default `'DARK_GOLD'`), `theme_config` (JSONB hex palette), `content_config` (JSONB guest-facing copy dictionary) columns on `hotels` table.
  - Types: `packages/supabase/types/index.ts` — Exported `GuestThemeMode`, `HotelThemeConfig`, `GuestWebContentConfig` (landing/dining/spa/requests/ai_chat/footer sections), and `GuestWebSettings` interfaces.
  - Libraries:
    - `apps/web/lib/guest-theme.ts` — 5 preset palettes (Dark Gold, Clean Light, Minimal White, Luxury Navy, Custom), `resolveGuestSurfaceTheme()` with per-field fallbacks, WCAG `contrastRatio()` helpers.
    - `apps/web/lib/guest-content.ts` — `DEFAULT_CONTENT` fallback dictionary + `mergeGuestContent()` deep-merge that never throws on null/empty/malformed values.
  - Guest Web Provider (`apps/web/app/app/stay/components/GuestSettingsProvider.tsx`):
    - Fetches `theme_mode`/`theme_config`/`content_config` from `hotels` on mount.
    - Supabase Realtime subscription on `hotels` table → admin publishes → guest UI updates live without refresh.
    - Injects CSS custom properties (`--gw-bg`, `--gw-surface`, `--gw-text`, `--gw-text-2`, `--gw-accent`, `--gw-border`) via `GuestThemeProvider`.
    - `useGuestContent()` hook supplies typed copy strings throughout the app.
  - Guest Web Pages Wired:
    - `stay/page.tsx` (landing hero) + `WelcomeCardClient.tsx` (welcome title, subtitle, room greeting, hero banner)
    - `dining/page.tsx` + `FnBDiningFAB.tsx` (title, subtitle, call button label, notes placeholder)
    - `spa/page.tsx` (title, subtitle)
    - `requests/page.tsx` (title, subtitle)
    - `dining/checkout/page.tsx` (instructions placeholder)
    - `CallFrontDeskModal.tsx`, `PhoneCaptureModal.tsx` (theme tokens)
  - Admin Branding Page (`apps/web/app/admin/branding/page.tsx` [NEW]):
    - 4 tabs: Visual Theme (preset swatches + custom color pickers + WCAG contrast indicators), Welcome & Landing, Sections & Modules, Live Preview (phone-sized mockup + JSON payload inspector).
    - Publish button commits JSON payloads to Supabase → triggers guest web realtime update.
  - Guest QR Resilience Fix (`apps/web/app/app/stay/page.tsx`):
    - Split room validation query from theme/content fetch so missing migration 24 columns don't crash QR flow with "Invalid QR Code" error.
    - Theme fetch now in separate `try/catch` with graceful fallback to DARK_GOLD defaults.

Files changed (high level)
- apps/web/app/admin/users/page.tsx [NEW]
  - Full CRUD User Account Control module for the Admin Web Portal (`/admin/users`).
  - Read: Comprehensive table displaying all staff accounts (Name with avatar initials, Email, Role pill with icons/custom themes, Status pill, and Created date) with live KPI cards, search by name/email, role filtering chips, and status filtering.
  - Create: Modal form to add a new staff user (Full Name, Email, Password with show/hide toggle, Role selection chips, and Active status toggle).
  - Update: Edit modal to modify existing user details, change departmental roles, toggle active status, and optionally reset passwords.
  - Delete / Deactivate: 1-click Activate/Deactivate quick action button and permanent delete confirmation modal.
  - Real-time sync: Subscribes to Postgres changes on `staff_users` table for live updates.
  - Export: CSV export functionality for staff user audits.
- apps/web/app/admin/page.tsx
  - Added "👥 User Account Control" card to the Core Portal Modules grid (`MODULES` array) linking to `/admin/users`.
  - Added "👥 Staff Control" quick action button to the top header bar.
- packages/supabase/types/index.ts
  - Added `StaffRole` and `StaffUser` type definitions.
- apps/staff-app/App.tsx
  - Cleaned up: Removed UAC component rendering and unused imports (UAC is centralized in the Admin Web portal at `/admin/users`).
- apps/staff-app/components/ManualSpaBookingModal.tsx
  - Rewrote `handleCreate()` to validate active locks, ensure `DEFAULT_ROOM_ID` exists with the deployed `rooms` schema, create a `BOOKED` lock before the request, roll the lock back if request creation fails, and insert an audit log.
  - Added granular minute controls and `scheduled_at` to manual and quick-add payloads.
  - Uses `maybeSingle()` for the optional fallback-room lookup and stops before request creation if room setup fails.

- apps/staff-app/components/EditSpaBookingModal.tsx
  - Added `confirmOnSave?: boolean` prop (default true). When false, saving updates the `payload` only and does not auto-confirm the request (used for pre-approval edits).
  - Added normalization to store `payload.room_number` as a raw value (strip `Room ` prefix) before saving.
  - Preserves existing payload fields and replaces the old lock when an appointment time changes, without deleting competing locks.
  - Uses the booking's `scheduled_at` date when resolving edit and conflict windows.

- apps/staff-app/components/SpaTimetable.tsx
  - Improved `convertTo24Hour()` to parse ISO datetimes and multiple time formats.
  - Timetable fetch now prefers `payload.scheduled_at` when deciding whether a booking belongs to the selected day (not `created_at`).
  - Handles `spa_slot_locks` and `requests` realtime events.
  - Improved room derivation: prefers the joined `rooms.room_number` relation (handles both object and array shapes), with multiple payload fallbacks.
  - Adds `rawPayload` & `rawRequest` to booking entries and a dev-only `🔧 Payload` viewer for debugging.
  - Open edit modal derives `roomNumber` from `rawRequest` when booking shows placeholder.
  - Prevents stale realtime fetches from overwriting newer state.
  - Keeps unmatched locks for availability blocking but hides them from appointment counts/cards, preventing misleading `Spa Desk` entries.

- apps/staff-app/components/SpaQueue.tsx
  - Added Modify (opens `EditSpaBookingModal`) and Call (uses `Linking.openURL('tel:')`) buttons on pending spa request cards.
  - Final UI polish: compact action row fits inside card bounds without clipping; approve is no longer exposed directly outside the edit modal to avoid double-approval and duplicate-booking errors.
  - On successful save from the edit modal, the queue immediately removes the edited item from the pending list and refreshes the source data so the card disappears without waiting on the timetable.
  - Emits a client `spa:revalidate` event after approve/decline so the timetable can refetch as a fallback when realtime updates are missed.

- apps/staff-app/components/IncomingRequestAlert.tsx
  - Guarded `expo-haptics` calls on web (import `Platform` and call `Haptics.notificationAsync` only when not `Platform.OS === 'web'`) to avoid runtime errors in browser builds.
  - Derives and formats room display (handles `rooms` relation array/object shapes).

- apps/staff-app/components/DedicatedCallModule.tsx
  - Improved `handleUpdateStatus()` to check responses and restore state on failure (bugfix for optimistic updates).

- Other updates
  - Added migration `packages/supabase/migrations/09_seed_default_room.sql` to create the `DEFAULT_ROOM_ID` server-side (ensure seed room exists to satisfy FK constraints).
  - Added documentation files: `AGENT_HANDOFF.md` (this file), and previously `AI_AGENT_CHECKLIST.md`.
  - Added `packages/supabase/migrations/11_scheduled_booking_expiration.sql` to make the SLA function use `scheduled_at` plus duration for new bookings. This migration is pushed but still requires manual application in Supabase.
  - Fixed Vercel Expo export blockers caused by duplicate declarations and malformed helper scope in `SpaTimetable.tsx` and `EditSpaBookingModal.tsx`.

Why these changes
- Some manual bookings created by staff did not create `spa_slot_locks`, causing timetable inconsistency. Adding the insert ensures locks and requests remain in sync.
  - Timetable previously filtered by `created_at`, which hid bookings scheduled for the day but created earlier. Using `payload.scheduled_at` fixes this for new bookings, with legacy time-only fallback behavior.
- Browser build errors occurred because `expo-haptics` is not available on web and because component imports were missing; guarding and fixing imports removes runtime exceptions.
  - Staff requested the ability to edit pending bookings before approving (pre-approval edits) and to call guests from the pending UI; the UI changes provide this flow and ensure edits are visible before approval.
  - A deployed room fallback mismatch caused `406`, `400`, and `409` errors. The client now uses `maybeSingle()`, valid room columns, and aborts safely when the fallback room cannot be created.

How to test locally
1. Install dependencies in workspace root (pnpm / npm):

   ```bash
   pnpm install
   cd apps/staff-app
   pnpm install
   ```

2. Run the staff app in web dev (Expo/Next.js dev is environment-specific). If using Expo web export locally, ensure `expo` is installed in `apps/staff-app` node_modules.

3. Reproduce the flows:
   - Create a pending SPA booking (guest app or seed a `requests` row with `request_type='SPA_BOOKING'` and `status='PENDING'`).
   - In Staff → Spa Appointments → Pending Requests: click `Modify` to open `EditSpaBookingModal`. Change therapist/time and Save (pre-approval). Confirm the pending card updates.
   - Click `Approve & Confirm` (now enabled after modify). Verify the booking appears in the Spa Master Timetable at the expected slot and room.
   - Trigger an incoming request and confirm there are no Haptics errors in the browser console.

Files of interest (paths)
- `apps/staff-app/components/ManualSpaBookingModal.tsx`
- `apps/staff-app/components/EditSpaBookingModal.tsx`
- `apps/staff-app/components/SpaQueue.tsx`
- `apps/staff-app/components/SpaTimetable.tsx`
- `apps/staff-app/components/IncomingRequestAlert.tsx`
- `packages/supabase/migrations/09_seed_default_room.sql`

Commits pushed
- Multiple commits were pushed to `main` during the session; check git history for messages prefixed with `feat(staff-app):`, `fix(staff-app):`, or `chore(staff-app):`.

Remaining / recommended follow-ups
- Run full TypeScript checks and Expo export locally to verify no other build-time issues. Install `expo` in `apps/staff-app` if exporting to web.
- Consider making `room_number` canonical across clients (always write raw numeric room in `payload.room_number`) — I normalized on save in the modal, but other clients may still write different fields.
- Add server-side constraint or migration to normalize legacy `payload.room_number` values if needed.
- Add tests for timetable logic (unit tests parsing `slot_time`, `room` derivation) to prevent regressions.

If you want, I can also:
- Create a small script to scan existing `requests` rows and patch `payload.room_number` to the canonical raw value when possible.
- Add an environment-controlled toggle to show the raw payload JSON in production for a short debugging window.

Contact & Handoff
- If something is still failing, paste the raw request object (from the timetable dev payload viewer or the console) and I will map exact fields to UI.

---
Generated by the agent during an interactive session. Use this file as the primary handoff document.

## Latest Update — 2026-08-25

- Updated `apps/staff-app/components/EditSpaBookingModal.tsx` to remove every active lock linked to the edited request or matching the original therapist/window before inserting the moved appointment lock.
- This addresses stale timetable cards that remain in the old time slot after an edit, including legacy locks without `request_id`.
- TypeScript validation passed with `pnpm --filter @hotel-qr/web exec tsc --noEmit`.
- Changes were committed and pushed to `main` as `4d6e8a6` (`Fix stale spa lock removals on time edits`).
- The user still reports duplicate/stale cards in the deployed staff app. Verify the Vercel deployment is running this commit, then inspect live `requests` and `spa_slot_locks` rows if the issue persists. No Supabase production migration was applied by this change.

## Latest Update - 2026-08-25

- Confirmed the duplicate-card root cause: the guest hold flow called `create_spa_reservation`, which already inserted a request, and final confirmation inserted a second request. The staff flow also treated the RPC `RETURNS TABLE` array response as an object and could incorrectly run fallback inserts.
- Updated `apps/web/app/app/stay/spa/page.tsx` so guest holds create only a `HELD` lock; final confirmation creates the single request and links it to that lock.
- Updated `apps/staff-app/components/ManualSpaBookingModal.tsx` to accept both object and one-row-array RPC responses, preventing a successful RPC from falling through to duplicate inserts.
- Web TypeScript validation passed with `pnpm --filter @hotel-qr/web exec tsc --noEmit`. The staff TypeScript check remains blocked by 17 pre-existing errors in unrelated files.
- Changes were committed and pushed to `main` as `1003ad4` (`Prevent duplicate SPA reservation creation`). Retest after Vercel deploy and clean up any duplicate rows already present in Supabase; this code change does not delete existing production data.

## Verified Resolution - 2026-08-25

- The user confirmed the SPA timetable is working correctly after the duplicate production rows were cleaned up in Supabase.
- The deployed fix now prevents new duplicate requests: guest holds are lock-only, final confirmation creates one request, and staff manual reservations correctly parse the RPC response.
- Existing stale/duplicate records were cleaned up separately in Supabase. This was a targeted data cleanup and did not alter the repository migration state.
- The Vercel deployment and the duplicate-card edit scenario are now considered verified for the current release. Keep the Supabase cleanup SQL available for any legacy rows created before commit `1003ad4`.

**Agent Handoff**

Purpose: Provide a concise handoff for a new AI agent or developer to continue work on this repository, including structure, recent changes, run instructions, and recommended next steps.

**Repository Structure (high level)**
- **apps/staff-app**: Expo/React Native staff application (web + native). Key components: [apps/staff-app/components/ManualSpaBookingModal.tsx](apps/staff-app/components/ManualSpaBookingModal.tsx), [apps/staff-app/components/SpaTimetable.tsx](apps/staff-app/components/SpaTimetable.tsx).
- **apps/web**: Next.js front-end (app router).
- **packages/supabase**: SQL migrations and DB types. Migrations live under [packages/supabase/migrations](packages/supabase/migrations).

**Recent changes (what was modified and why)**
- [apps/staff-app/components/ManualSpaBookingModal.tsx](apps/staff-app/components/ManualSpaBookingModal.tsx): Fixed syntax/brace imbalance; rewrote `handleCreate` to reliably seed a `DEFAULT_ROOM_ID`, insert `requests`, create `spa_slot_locks`, and add audit logs. Removed fragile catch/type patterns that broke web export.
- [apps/staff-app/components/SpaTimetable.tsx](apps/staff-app/components/SpaTimetable.tsx): Timetable parsing and realtime subscription fixes so bookings display correctly using `payload.slot_time` and explicit realtime handlers.
- [apps/staff-app/components/EditSpaBookingModal.tsx](apps/staff-app/components/EditSpaBookingModal.tsx): Safer error handling and compatibility fixes for web export.
- [apps/staff-app/app.json](apps/staff-app/app.json): Added `platforms` to support web export.
- [apps/staff-app/package.json](apps/staff-app/package.json): Pin/adjusted `build:web` script for `expo export` compatibility.
- [packages/supabase/migrations/09_seed_default_room.sql](packages/supabase/migrations/09_seed_default_room.sql): Server-side seed to ensure `DEFAULT_ROOM_ID` exists (run this migration in your Supabase instance).

**Key concepts & constraints**
- The `requests.room_id` column has a foreign-key constraint to `rooms.id`; missing seed causes HTTP 409 when inserting requests. Server migration + client-side seed guard were added to avoid this.
- Staff manual bookings must create a `spa_slot_locks` row so the timetable and other systems see the booking immediately.
- Expo web export historically failed due to typed `catch (err: any)` or optional chaining inside `catch`. Use plain `catch (err)` or ensure transpiler supports typed catch in your toolchain. We rewrote code to avoid fragile patterns.

**How to run locally (developer steps)**
1. Install dependencies (workspace root):

```bash
pnpm install    # or npm install
```

2. Staff app TypeScript check:

```bash
npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json
```

3. Expo web export (run from staff app):

```bash
cd apps/staff-app
npx expo@~54 export --platform web
```

4. Next.js web dev:

```bash
cd apps/web
pnpm dev
```

**Database / Supabase notes**
- Migrations live in [packages/supabase/migrations](packages/supabase/migrations). Apply them in your Supabase project; specifically run `09_seed_default_room.sql` to ensure `DEFAULT_ROOM_ID` exists.
- Realtime behavior: `spa_slot_locks` and `requests` are used by the staff-app timetable; ensure RLS policies allow the intended inserts during migrations or use admin credentials for seeding.

**Vercel / Deployment notes**
- Vercel will install dependencies and run the configured build. After pushing to `main` the site should trigger a new deploy. If web export fails on Vercel, confirm `apps/staff-app/app.json` contains `platforms` and that `expo` is resolved via the lockfile.

**Coding conventions & AI guidance**
- Prefer minimal, focused edits. Fix root cause rather than quick hacks.
- When modifying code that runs during build/export, avoid typed catch bindings or optional chaining inside `catch` if the build toolchain is older — use conservative patterns for compatibility.
- Prefer server-side migrations for persistent data (like `DEFAULT_ROOM_ID`) rather than only client-side seeding.
- When resolving merge conflicts, prefer the existing repo version if unsure, but include comments explaining non-obvious choices.

**Files to review first (entry points for new agent)**
- [apps/staff-app/components/ManualSpaBookingModal.tsx](apps/staff-app/components/ManualSpaBookingModal.tsx)
- [apps/staff-app/components/SpaTimetable.tsx](apps/staff-app/components/SpaTimetable.tsx)
- [packages/supabase/migrations/](packages/supabase/migrations)
- [apps/staff-app/package.json](apps/staff-app/package.json)

**Immediate next tasks (recommended)**
- Run the full test/build cycle on your machine or CI: install deps, run `tsc`, run `expo export`, and verify Vercel deploy logs. (Priority: confirm build passes.)
- Apply `09_seed_default_room.sql` to Supabase to avoid FK 409 errors in production.
- Add a lightweight e2e or integration test for manual booking flow that verifies `requests` insert and `spa_slot_locks` creation.
- Check the live staff app against the browser scenario: edit a pending booking from the queue, save, confirm it disappears from pending queue instantly, and verify it appears in the timetable/history only once.
- Review any outstanding worktree changes before a larger repo-wide cleanup, especially unrelated modified files like `context.md` or migration scripts.

**Contact & context**
- Commits with recent fixes were pushed to `main` (latest includes the ManualSpaBookingModal fix). Check commit history for details.

---
If you want, I can:
- commit this handoff file to the repo and push it, and
- create small follow-up tasks (tests or CI adjustments).

## Latest Update — 2026-09-04

### Admin branding is now managed from hotel settings
- The admin shell now reads the live hotel display name from the `hotels` table instead of hardcoded text like `Grand Hotel` / `Grand Hotel & Spa`.
- The hotel name is used for the admin top bar, dashboard header, and room QR print badges.
- This keeps the property title centralized in the admin settings page, which is the source of truth for the hotel identity.

### Mobile-friendly admin layout cleanup
- The admin header was compacted and reflowed to work better on phones and small tablets.
- Navigation chips now wrap cleanly instead of crowding the header.
- Sign-out and user display elements were tuned for mobile width without losing the desktop layout quality.

### Function room booking finalization completed
- The function room module accepts multi-room bookings as a single logical booking with a combined room name summary.
- Room history displays comma-separated room names and preserves booking details such as catering notes, equipment rentals, and notes for audit review.
- Edit operations record a structured audit log update and preserve relevant room summary metadata.
- Cancel actions now support a cancellation reason and record it in the booking notes and audit history.
- The compact summary UI remains collapsed by default to avoid crowding the staff dashboard while still allowing expansion when needed.

### Verification notes
- Web admin TypeScript validation passed using:
  - `cd "c:/AMD/New folder/hotel-qr-ordering-system"; pnpm --dir "apps/web" exec tsc --noEmit`
- This was used to validate the admin branding and mobile layout changes before documentation handoff.

## SPA Module Architecture and Data Flow Review

### End-to-end booking flow

1. **Guest selects a service and time**
  - `apps/web/app/app/stay/spa/page.tsx` loads available `catalog_items` and active `spa_slot_locks`.
  - The guest selects one of six hard-coded time labels for today. `getSlotWindow()` converts the label into a local browser `Date`; if that time has passed, it silently moves the appointment to tomorrow.
  - `handleSelectSlot()` immediately inserts a `HELD` lock for ten minutes. The guest-side lock does not include a `therapist_id` or `request_id`.

2. **Guest submits intake and contact details**
  - `executeConfirmBooking()` inserts a `requests` row with `request_type = 'SPA_BOOKING'` and status `PENDING` or `PENDING_ON_CALL`.
  - The request payload contains service, time, room, price, duration, notes, phone, and `scheduled_at`.
  - The guest subscribes to request status changes. The hold lock is then changed from `HELD` to `BOOKED`; errors from this update are currently not surfaced to the guest.

3. **Staff queue receives the request**
  - `apps/staff-app/components/SpaQueue.tsx` fetches pending SPA requests and subscribes to all request realtime events.
  - Staff can edit, call, or cancel. Editing opens `EditSpaBookingModal`; the modal performs the confirmation path and writes a therapist lock before updating the request.
  - The queue’s direct status handler updates `requests` only. Any future caller of that handler for confirmation would need a lock transaction as well.

4. **Staff manual or quick-add booking**
  - `apps/staff-app/components/ManualSpaBookingModal.tsx` loads services and therapists, checks active locks, and gathers room, service, therapist, time, and notes.
  - Quick-add is launched from an empty timetable cell by `SpaTimetable.handleQuickAdd()`. It carries the selected therapist and Today/Tomorrow day into the modal.
  - The modal creates a `BOOKED` lock first, inserts a confirmed `requests` row second, and removes the lock if the request insert fails.

5. **Timetable builds its display model**
  - `apps/staff-app/components/SpaTimetable.tsx` loads active requests, history candidates, and active locks, then combines them into `BookingSlot[]`.
  - Requests render as real booking cards. Locks that cannot be matched to a request render as `Spa Desk / Slot Reserved` cards.
  - Realtime INSERT, UPDATE, and DELETE events for both `requests` and `spa_slot_locks` trigger a complete refetch. A browser-only `spa:revalidate` event is an additional fallback.

6. **Completion, cancellation, and expiry**
  - Timetable cancellation changes the request to `CANCELLED` and releases an overlapping therapist lock.
  - History completion changes the request to `RESOLVED` and releases the lock.
  - Timetable fetch marks old active locks as `EXPIRED` when `end_time < NOW()`.
  - The Supabase `check_sla_breaches()` function originally used `created_at`; migration `11_scheduled_booking_expiration.sql` uses payload `scheduled_at` plus duration for new rows and retains a legacy fallback for old rows. This migration must be applied to the live Supabase project separately from Vercel deployment.

### Confirmed edge cases and risks

- **High: no atomic reservation.** Availability is checked with SELECT, then a lock is inserted separately. Two clients can pass the check simultaneously. The current UI checks reduce normal collisions, but only a database exclusion constraint or transactional RPC can guarantee uniqueness under concurrency. This requires an explicitly reviewed Supabase migration/RPC.
- **High: locks are not linked to requests.** `spa_slot_locks` has `session_id` but no `request_id`. Staff cannot reliably identify which lock belongs to which booking, so orphaned locks appear as `Spa Desk`, and cleanup can target the wrong row. A production schema change should add a nullable request reference or use a reservation RPC.
- **High: guest holds still need server cleanup.** The client now releases holds on back navigation, timeout, unmount, and failed submission, but browser termination is not guaranteed and the database still needs server-side expiry enforcement.
- **High: guest availability is not therapist-aware.** Guest-created locks omit `therapist_id`, while staff availability is therapist-based. This makes a guest hold either invisible to therapist conflict checks or visible only as an unassigned `Spa Desk` reservation.
- **Medium: date and timezone ambiguity remains for legacy paths.** New booking rows store and use `scheduled_at`, but legacy time-only rows and some fallback paths still derive dates locally. Browser timezone and Supabase UTC conversion can also shift the displayed day.
- **Medium: stale edit lock selection.** The edit modal identifies the old lock by overlapping time and therapist rather than a request reference. Similar adjacent bookings or changed service duration can make that heuristic ambiguous.
- **Medium: payload compatibility depends on caller data.** `EditSpaBookingModal` now merges the payload supplied by its caller, but callers that do not pass the original payload cannot preserve fields that were never loaded.
- **Medium: realtime burst behavior.** Timetable fetch results are version-guarded, but multiple realtime events can still cause redundant full fetches and short-lived intermediate states.
- **Medium: queue tenant isolation.** `SpaQueue` queries and realtime handling do not consistently filter by `HOTEL_ID`. In a multi-property deployment, staff could receive another hotel’s SPA requests if RLS does not fully enforce isolation.
- **Low: hard-coded time UX.** Guest time choices are fixed to six labels and the guest page says “Today,” while staff supports granular minutes and Today/Tomorrow. The two clients can represent the same booking differently and cannot offer a general future date.
- **Low: history duplication.** `shouldMoveBookingToHistory()` treats guest/manual payloads as history candidates independently of appointment completion, so an active booking can be eligible for both the active timetable and history views.

### State-management and UX findings

- The guest hold countdown is not authoritative and can continue displaying a held slot after the database lock has expired.
- Guest service/time state is not reset centrally after completion or a failed submission; returning to the flow can retain stale selection state.
- The staff conflict map is calculated asynchronously and save can occur before the latest check completes. The final write-time check is still necessary and should be authoritative.
- Manual and edit forms now preserve granular minutes, but the timetable grid groups cards by hour. A `15:15` booking is rendered in the `15:00` row, which is acceptable only if the card’s exact time remains prominent.
- Cancel actions use `Alert` confirmation on native/web. This is functional but less predictable in the embedded browser than an in-modal confirmation state.
- Unmatched locks are now hidden from appointment cards while still blocking availability. A future staff cleanup workflow is still needed to investigate and remove verified orphaned rows.

### Recommended order of future hardening

1. Apply and verify migration `11_scheduled_booking_expiration.sql` in Supabase; test a future booking against the live scheduled timestamp behavior.
2. Add a server-side reservation RPC that checks overlap and creates/updates the lock and request in one transaction.
3. Add `request_id` to `spa_slot_locks` or equivalent durable linkage, then make edit/cancel/complete operations target the exact lock.
4. Store an explicit scheduled timestamp/date in every client and make timetable filtering, expiry, history, and lock cleanup use it consistently.
5. Add cleanup on guest back/timeout/failure and verify held-lock expiry server-side.
6. Scope every staff query and realtime subscription by hotel, then add tests for cross-hotel isolation.
7. Add focused tests for time parsing, timezone/day boundaries, overlap rules, lock replacement, rollback, and duplicate realtime events.

---

## Session Update — 2026-08-25 (Comprehensive Audit Trail & Real-Time Booking History)

### Overview

This session implemented a comprehensive audit trail across the entire spa booking lifecycle and completely rebuilt the **Booking History** section of `SpaTimetable.tsx` so that every booking event — creation, modification, approval, completion, and cancellation — is automatically recorded in `audit_logs` and rendered in real-time.

**Commit:** `ab5c145` — `feat(spa): implement comprehensive audit trail and real-time booking history`

---

### Root Cause Fixed

Previously, newly created bookings (both guest-web and staff manual) were **not visible** in the Booking History panel. The `shouldMoveBookingToHistory()` function only moved bookings to history if their appointment window was in the past, so any active or future booking was silently excluded.

The fix replaced the old history mechanism entirely with a dedicated `audit_logs` feed + merged request events, covering the full lifecycle regardless of appointment time.

---

### What Changed (Files)

#### `apps/web/app/app/stay/spa/page.tsx`
- After a guest successfully confirms a booking, inserts `GUEST_BOOKING_CREATED` into `audit_logs` with full booking context: `room_number`, `service_name`, `slot_time`, `scheduled_at`, `duration_mins`, `price`, and `guest_phone`.

#### `apps/staff-app/components/ManualSpaBookingModal.tsx`
- After successful staff walk-in / manual booking, inserts `MANUAL_BOOKING_CREATED` into `audit_logs` with: therapist name, room, service, scheduled slot, price, duration, and intake notes.
- Added missing `timeChipTextDisabled` style.

#### `apps/staff-app/components/EditSpaBookingModal.tsx`
- Before saving edits, builds an explicit before/after diff object capturing `time_changed`, `therapist_changed`, `service_changed`, and `notes_changed`.
- Inserts `BOOKING_EDITED` into `audit_logs` with a human-readable `summary` of changes.
- Fixed `newLock` type (`never`) by using `(supabase as any).select('id').single()`.
- Added missing `timeChipDisabled` and `timeChipTextDisabled` styles.

#### `apps/staff-app/components/SpaQueue.tsx`
- Added `BOOKING_APPROVED` and `BOOKING_DECLINED` audit log inserts when staff approves or declines from the queue.
- Extended `SpaRequestItem.payload` interface to include `guest_phone`, `therapist_id`, `assigned_therapist`, and `scheduled_at`.

#### `apps/staff-app/components/SpaTimetable.tsx`
- **New types / helpers:**
  - `AuditHistoryItem` interface (id, requestId, action, actionCategory, actionLabel, actionColor, badgeBg, roomNumber, serviceName, slotTime, therapistName, timeAgo, summary, timestamp, status, details, rawRequest).
  - `formatRelativeTime(iso)` — relative human-readable timestamps (`Just now`, `5m ago`, etc.).
  - `parseAuditHistoryItem(log, requestMap)` — converts an `audit_logs` row into an `AuditHistoryItem` for display.
- **State additions:** `historyEvents`, `historyFilter`, `selectedHistoryItem`, `requestAuditTrail`, `loadingAuditTrail`.
- **`fetchTimetableData`** — now also fetches `audit_logs` filtered by `SPA_BOOKING` action categories; merges and deduplicates with requests; sorts newest-first into `historyEvents`.
- **Realtime** — added Supabase channel subscription on `audit_logs` (INSERT / UPDATE) to refresh history in real time.
- **`handleSelectHistoryItem`** — async loader that fetches all audit events for a specific `request_id` and loads them into `requestAuditTrail`.
- **`handleHistoryCompletion`** — updated to accept `AuditHistoryItem` (previously `selectedHistoryBooking` typed as `any`).
- **JSX — History section completely rebuilt:**
  - Header now shows count from `historyEvents`.
  - **Filter tabs** (horizontal scroll pill bar): `All`, `✨ Created`, `✏️ Modified`, `✓ Confirmed`, `✓ Completed`, `✕ Cancelled`.
  - **Event cards**: color-coded action badge, room & service, therapist, slot time, relative timestamp, change diff summary.
  - **Detail modal** (`selectedHistoryItem`): full booking snapshot — status, room, service, therapist, scheduled slot, duration, price, phone, event time, notes — followed by a **📜 Audit Trail Timeline** showing every logged event for that booking with vertical connector line nodes.
- **Styles added:** `historyContainer`, `historyFilterScroll`, `historyFilterRow`, `historyFilterTab`, `historyFilterTabActive`, `historyFilterTabText`, `historyFilterTabTextActive`, `historyBadgeContainer`, `historySummaryBox`, `historySummaryText`, `historyDetailSub`, `timelineSection`, `timelineHeader`, `timelineEmptyBox`, `emptyTimelineText`, `timelineList`, `timelineItem`, `timelineLeft`, `timelineDot`, `timelineLine`, `timelineRight`, `timelineTitleRow`, `timelineAction`, `timelineTime`, `timelineDate`, `timelineDetailsText`.
- **`SpaSlotLock` interface** extended with `request_id?: string | null`.

#### `apps/staff-app/components/FoodQueue.tsx`
- Removed invalid `flexHorizontal: 1` property from `modalCardLarge` style (was causing a TypeScript strict-style error).

#### `apps/staff-app/components/TaskQueue.tsx`
- Added `request_type?: string` to `TaskRequest` interface (was causing a TypeScript error at line 114).

#### `apps/staff-app/components/UserManagement.tsx`
- Added missing `emailText` style used at line 44 in the component JSX.

#### `apps/web/app/admin/page.tsx` + `settings/page.tsx` + `rooms/page.tsx` + `requests/page.tsx` + `audit/page.tsx` + `analytics/page.tsx`
- Replaced inline `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` pattern with `createSupabaseBrowserClient()` from `@/lib/supabase-browser`.
- This fixes a Next.js SSG prerender crash: the old pattern threw `@supabase/ssr: Your project's URL and API key are required` at build time because `process.env` vars are not available during static generation. The `supabase-browser.ts` helper uses placeholder fallbacks and defers the real connection to the browser.

#### `apps/web/app/app/stay/requests/page.tsx`
#### `apps/web/app/app/stay/components/PhoneCaptureModal.tsx`
#### `apps/web/app/app/stay/components/ActiveRequestsBanner.tsx`
#### `apps/web/app/app/stay/components/FrontDeskFAB.tsx`
- Same `createBrowserClient` → `createSupabaseBrowserClient()` migration as admin pages above.

---

### Build Verification Results

| Check | Command | Result |
| :--- | :--- | :--- |
| Web TypeScript | `pnpm --filter @hotel-qr/web exec tsc --noEmit` | ✅ 0 errors |
| Staff-app TypeScript | `npx tsc --noEmit` (in `apps/staff-app`) | ✅ 0 errors |
| Next.js production build | `pnpm --filter @hotel-qr/web build` | ✅ All 18 routes built & statically prerendered |
| Expo Web export | `npx expo export --platform web` (in `apps/staff-app`) | ✅ 0 errors |

---

## Web Application Architecture (`apps/web`)

The web application is built using **Next.js 16 (App Router)**, **React 19**, **TypeScript**, and **Vanilla CSS tokens with Glassmorphism styling**. It is hosted on Vercel (`https://hotel-qr-ordering-system-web.vercel.app`).

### 1. Supabase Initialization Architecture
To prevent Next.js build-time prerendering / SSG crashes, **all browser-side clients** must use the factory wrapper in `apps/web/lib/supabase-browser.ts`:
```ts
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
const supabase = createSupabaseBrowserClient()
```
*Never* call `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` directly in page components, as environment variables are absent during static page compilation on CI/Vercel.

---

### 2. Admin Web Portal (`/admin`)
Central executive and operational management hub for property settings, catalog control, staff administration, and dispute resolution.

| Route | Page Name | Primary Responsibilities |
| :--- | :--- | :--- |
| `/admin` | **Admin Dashboard** | Real-time operational KPI overview (Active Sessions, Revenue, TTA, SLA Compliance), core modules navigation grid, and live audit event stream. |
| `/admin/users` | **User Account Control (UAC)** | Full CRUD management for staff accounts (`staff_users` table): interactive search/filter by role & status, add user modal, edit user & role modal, activate/deactivate toggle, delete account confirmation, real-time sync, and CSV export. |
| `/admin/settings` | **Hotel Settings & Branding** | Configure property name, direct front desk phone number, logo graphic URL, and guest web app color scheme tokens. |
| `/admin/analytics` | **Executive ROI Analytics** | Departmental revenue breakdown (F&B vs. Spa), request volume trends, average acknowledgment times, SLA compliance rates, and CSV data export. |
| `/admin/spa` | **Spa Catalog & Therapists** | Manage spa treatments, pricing, durations, 86/out-of-service toggles, and therapist shift roster with on-call availability flags. |
| `/admin/fb` | **F&B Kitchen & Bar Menu** | Real-time dish & beverage catalog management, pricing, stock availability toggles, dietary tags (`VEGAN`, `GLUTEN_FREE`, `HALAL`, etc.), and numerical sort order. |
| `/admin/requests` | **Task & SLA Builder** | 1-tap room request catalog builder, departmental priority routing (`LOW` to `URGENT`), and target resolution SLA windows. |
| `/admin/audit` | **Immutable Audit Logs** | Comprehensive unalterable audit trail across all guest and staff events, interactive request timeline modal for dispute settlement, and filtered CSV exports. |
| `/admin/rooms` | **Room & QR Manager** | Generate, preview, print, and delete room QR codes that embed secure auth hashes (`/app/stay?room=<id>&hash=<hash>`). |

---

### 3. Guest Web Portal (`/app/stay`)
Mobile-first guest in-stay experience designed for instant browser access via room QR scan without requiring app installation.

| Route / Component | Purpose & Features |
| :--- | :--- |
| `/app/stay` | **Guest Hub Home**: Validates room session via QR parameters, loads dynamic property branding/theme tokens (`GuestThemeProvider`), displays active requests banner, and provides navigation to dining, spa, housekeeping, and front desk call modal. |
| `/app/stay/dining` | **In-Room Dining Catalog**: Categorized dish & beverage list, search, dietary filter pills, detailed item customization modal, and persistent floating cart drawer. |
| `/app/stay/dining/checkout` | **F&B Checkout & Ordering**: Cart review, special instructions, fulfillment mode selection (`ROOM_SERVICE` vs. `DINE_IN`), delivery preferences, and order submission. |
| `/app/stay/spa` | **Spa Treatment Booking**: Service catalog, date & therapist selection, real-time slot availability, transactional lock hold countdown (`spa_slot_locks`), phone number capture, and booking confirmation with audit logging. |
| `/app/stay/requests` | **Room Service Tasks**: 1-tap amenity requests (extra towels, pillow menu, toiletries, housekeeping, luggage assistance, technical maintenance) with live SLA countdown tracking. |
| `components/ActiveRequestsBanner.tsx` | Sticky real-time banner displaying active in-flight requests and their current fulfillment status (`PENDING`, `PREPARING`, `CLAIMED`, `RESOLVED`). |
| `components/CallFrontDeskModal.tsx` | 1-tap direct call prompt and VoIP/dialer launcher to the hotel's configured front desk telephone line. |
| `components/FrontDeskFAB.tsx` | Persistent bottom-right floating action button allowing guests to trigger front desk assistance from any guest page. |
| `components/PhoneCaptureModal.tsx` | Lightweight prompt for guest contact number required during appointment and delivery notifications. |

---

## Recent Session Accomplishments (August 2026)

### 1. User Account Control (UAC) Relocation to Web Admin (`apps/web/app/admin/users/page.tsx`)
- Moved staff account management from mobile/staff app into the Web Admin portal (`/admin/users`).
- Built full CRUD operations against `staff_users` table:
  - **Read**: Live searchable table with role & status filters, sorting, and CSV export.
  - **Create**: Add new staff account modal with validation.
  - **Update**: Edit user details, assign departments/roles (`ADMIN`, `FRONT_DESK`, `KITCHEN`, `HOUSEKEEPING`, `SPA`, `MAINTENANCE`), and toggle active status.
  - **Delete**: Account deletion with confirmation modal.
- Connected real-time PostgreSQL subscriptions for instant synchronization across sessions.

### 2. Food & Beverage (F&B) Ecosystem Overhaul
- **Database & Storage**: Added `13_menu_categories_and_storage.sql` migration creating the `menu_categories` table and public `menu-thumbnails` Supabase Storage bucket.
- **Admin Panel (`/admin/fb`)**:
  - **Category CRUD**: Create, rename, sort, and delete menu categories with item count safeguards.
  - **Photo Uploads**: Client-side image compression (`canvas` resizing to ≤800px / JPEG 0.8) and direct upload to Supabase Storage with live preview.
  - **Bulk Operations**: 1-click CSV Export of all menu items, and batch CSV Import with format validation, error reporting, and preview table. Downloadable CSV template provided.
- **Guest In-Room Dining (`/app/stay/dining`)**:
  - Re-architected with hero banner, live search bar, horizontal dietary filter chips, category quick-jump bar, and floating persistent cart.
  - **Bug Fix**: Resolved infinite re-render loop on scroll caused by `activeCategory` dependency inside `fetchMenuData`.

### 3. Staff App Audit Logs & 400 Bad Request Fix
- **Root Cause**: PostgREST rejected audit log inserts with HTTP 400 because `FoodQueue.tsx` was passing `actor_role: 'STAFF'` as a top-level column (which doesn't exist on `audit_logs`) and wrapping `details` in `JSON.stringify()` rather than passing a raw JSONB object.
- **Resolution**:
  - Moved `actor_role` inside `details` and passed raw JS objects for JSONB columns.
  - Wrapped all `audit_logs` queries and inserts in defensive `try/catch` blocks across `SpaTimetable.tsx`, `SpaQueue.tsx`, `FoodQueue.tsx`, `ManualSpaBookingModal.tsx`, and `EditSpaBookingModal.tsx`.
  - Added UUID format validators (`isValidUuid`) to ensure non-UUID string IDs fallback to `null` on Postgres UUID columns.
  - Restored therapist lock release logic (`releaseSpaLockForWindow`) in `SpaTimetable.tsx`.

### 4. Staff App Request History (`apps/staff-app/components/RequestHistory.tsx`)
- Complete overhaul matching `SpaTimetable` history architecture:
  - **Interactive Detail Drawer**: Tapping any request card opens a bottom-sheet modal with full metadata, room info, food/spa itemization, and a vertical live `audit_logs` timeline.
  - **Staff Name Lookup**: Fetches `staff_users` on mount to resolve `claimed_by` UUIDs to real staff names (e.g. "Front Desk Admin" instead of `Staff #dacb6e69`).
  - **Filters & Sorting**: Category chips (All / Food / Spa / Calls / Tasks) and Room/Date sort toggles.

### 5. Staff App Spa Queue Fluid Layout (`apps/staff-app/components/SpaQueue.tsx`)
- Removed `maxWidth: 600` and rigid margins that caused card cramping and misalignment on wide screens.
- Redesigned with a 100% fluid glassmorphic container matching the rest of the dashboard.
- Added direct **`✓ Accept` (Confirm)** button in the card action bar alongside `✏️ Edit`, `📞 Call`, and `✕ Decline`.
- Real-time subscriptions now cleanly trigger refetches to guarantee relational `rooms(room_number)` joins are always populated.

### 6. Guest Room Services Mobile UI Redesign (`apps/web/app/app/stay/requests/page.tsx`)
- **Prominent Navigation**: Enforced large, thumb-friendly **`← Back to Concierge`** button and room status badge.
- **Category Filter Chips**: Added horizontal scrollable department filter chips (`🌟 All Services`, `🎩 Front Desk`, `🧹 Housekeeping`, `🔧 Maintenance`, `✍️ Custom`).
- **Contextual Emojis**: Replaced generic bell icons with dedicated contextual icons (🔑, ⏰, 🧳, 🧖, 🛏️, 🧴, ✨, 🧺, ❄️, 📺, 🚿, 💡).
- **Mobile Touch Targets**: Enlarged quantity adjusters to 56px and action CTA buttons (`min-h-[56px]`).
- **Bottom Sheet Modal**: Designed mobile bottom-sheet modal with backdrop blur for service customizations.

### 7. Web Admin Authentication Wall & Role Gate (`apps/web/app/admin/layout.tsx`)
- **Global Auth Guard**: Protected all `/admin/*` routes with `AdminAuthProvider` and `AdminAuthGuard`.
- **Database Authentication**: Checks user against `staff_users` table by email and password.
- **Role Authorization**: Exclusively admits accounts with **`ADMIN`** or **`MANAGER`** roles; rejects other roles with clear access denied notifications.
- **Login UI (`AdminLoginForm.tsx`)**: Luxury dark-glass design, password reveal toggle, live error feedback, and loading indicators.
- **Global Admin Header**: Renders persistent navigation bar across desktop and mobile, active user profile pill (`[Name] · [ROLE]`), and one-click **Sign Out** button.

### 8. Guest Spa Slot Availability & Day Selection Fix (`apps/web/app/app/stay/spa/page.tsx`)
- **Root Cause of Inactive Slots**: The guest app previously compared time windows against *all* locks in the database (including stale/past locks) without checking active therapist count, and improperly shifted timestamps forward when earlier than current time.
- **Resolution**:
  - Added **`📅 Today` vs `📅 Tomorrow`** date selection tabs matching the Staff App's Master Timetable.
  - Corrected slot window date calculation to accurately align with the selected target day.
  - Filtered out expired locks (`end_time < NOW()`).
  - Integrated therapist capacity: slots are now only marked "Fully Booked" if active locks equal or exceed the total count of active therapists.
  - Differentiated between **`Passed`** (for earlier times today), **`Booked`**, **`⚠️ On-Call Request`**, and **`✓ Available`**.
  - Added real-time listener on `spa_slot_locks` so staff modifications in `SpaTimetable` reflect immediately on the guest booking screen.

### 9. Staff App Edit Dining Order Menu Filtering & Fluid Modal Layout (`apps/staff-app/components/FoodQueue.tsx`)
- **Single Source of Truth**: Removed all dual-table querying to `menu_catalog`. All dining food, drink, and dessert menus across both **Staff App** (`FoodQueue.tsx`) and **Guest Web App** (`/app/stay/dining`) now pull exclusively from `catalog_items` where `department = 'F_AND_B'`.
- **Cleaned Data Isolation**: Amenities, Spa treatments, Housekeeping tasks, Maintenance items, and Front Desk items are completely isolated by department.
- **Dynamic Category Tabs**: Categories are dynamically extracted from active `F_AND_B` catalog items.
- **Fluid, Non-Overflowing Modal**: The restaurant menu browser is housed in a dedicated scroll container (`height: 260`), ensuring smooth navigation and zero layout overflow on mobile and tablet devices.

### 10. Configurable Dining Service Charge (`feat: d9a9d36`)

**Goal**: Add a percentage-based service charge that applies to all dining orders only, fully controllable from the Admin Settings page.

#### Database (`apps/web/supabase/migrations/14_service_charge.sql`)
- New columns on `hotels` table:
  - `service_charge_enabled` (boolean, default `true`)
  - `service_charge_pct` (numeric 5,2, default `10.00`)
- **Must be run manually on the Supabase production instance** (no automatic migration runner).

#### Admin Settings (`apps/web/app/admin/settings/page.tsx`)
- New **💳 Service Charge** card (labeled "Dining Only") in the settings form:
  - **ON/OFF toggle**: animated pill switch with green glow when active.
  - **Percentage input**: number field (0–100, step 0.5), grayed out when toggle is OFF.
  - **Live preview**: shows a sample ₱500 order with computed charge and grand total, or a "charge disabled" message.
- Reads from and PATCHes to the `hotels` table alongside existing settings.

#### Dining Menu Notice (`apps/web/app/app/stay/dining/page.tsx`)
- On mount, fetches `service_charge_enabled` + `service_charge_pct` from `hotels`.
- When enabled, renders an amber **💳 notice banner** in the sticky header: *"All dining items are subject to a X% service charge, applied at checkout."*
- Floating cart bar shows a small hint below the subtotal: *"+X% service charge at checkout"*.
- Notice disappears entirely when the admin disables the charge.

#### Checkout Breakdown (`apps/web/app/app/stay/dining/checkout/page.tsx`)
- Fetches hotel service charge on mount.
- Replaces the previous single "Total" row with a **3-row price breakdown**:
  - Subtotal
  - Service Charge (X%) — amber colored, hidden when disabled
  - **Total** — orange, bold
- An amber footnote pill below the breakdown reinforces the charge.
- **Place Order** button label uses `grandTotal` (subtotal + charge).
- `requests.payload` now carries:
  - `subtotal` — raw item total
  - `service_charge_pct` — rate applied (0 if disabled)
  - `service_charge_amount` — computed charge
  - `total_price` — grand total (used by staff in FoodQueue)

### 11. Staff App Service Charge Integration in Edit Orders, History & Audit Logs (`apps/staff-app`)

**Goal**: Full alignment of the dining service charge across the staff dashboard, including modified dining orders, pending card badges, detailed request history drawers, and audit log timelines.

#### Staff App Edit Order Modal (`apps/staff-app/components/FoodQueue.tsx`)
- **Live Configuration Fetch**: Reads `service_charge_enabled` and `service_charge_pct` from `hotels` table, with real-time updates when hotel settings change.
- **Dynamic Service Charge Computation**: When adding/removing items or modifying quantities in the *Edit Dining Order* modal:
  - Computes `itemsSubtotal`
  - Applies order's `service_charge_pct` (or hotel's active percentage if not yet set)
  - Computes `serviceChargeAmt` and `newTotal`
- **Modal Footer Breakdown**: Displays:
  - *Items Subtotal*: `₱[Subtotal]`
  - *Service Charge (X%)*: `+₱[SC]` (amber colored, hidden when disabled)
  - *New Order Total*: `₱[Grand Total]`
- **Payload & Database Update**: `saveModifiedOrder` updates `requests.payload` with:
  - `subtotal`
  - `service_charge_pct`
  - `service_charge_amount`
  - `total_price` (grand total)
- **Pending Order Cards**:
  - Displays formatted total with 2 decimal places.
  - Shows an amber badge `incl. X% SC` next to total and itemized `💳 Service Charge (X%)` line in the items list.

#### Staff App Request History & Logs (`apps/staff-app/components/RequestHistory.tsx`)
- **Detail Modal Breakdown**: In the request drawer for dining orders, replaced raw total text with structured breakdown:
  - *Items Subtotal*: `₱[Subtotal]`
  - *Service Charge (X%)*: `+₱[SC]` (amber colored)
  - *Grand Total*: `₱[Total]` (bold orange)
- **Audit Trail Formatting**: Formats `MODIFY_DINING_ORDER` log entries to clearly show:
  - `📝 Order Updated: ₱[New Total] (incl. ₱[SC] service charge)`
  - Structured summary and modified items itemization in audit timeline.

#### Type Definitions (`packages/supabase/types/index.ts`)
### 12. Staff App Food Queue Realtime Sync & Optimistic UI Updates (`apps/staff-app/components/FoodQueue.tsx`)

- **Root Cause of UI Stagnation & Delayed Cards**:
  - The realtime subscription in `FoodQueue.tsx` previously used `filter: request_type=eq.FOOD_ORDER`. In Supabase Postgres Realtime, column filters on non-primary-key columns cause `UPDATE` events to be dropped when tables use default replica identity.
  - Action handlers (`updateStatus` for *Prepare* and *Order Ready*, `saveModifiedOrder`, and `confirmRejection`) only updated Supabase without updating local React state optimistically or synchronously triggering state refresh.
  - Furthermore, `fetchData` in `useEffect([])` captured a stale mount-time closure, causing realtime events to trigger an outdated closure.
- **Resolution**:
  - Removed the broken column filter from `supabase.channel('staff-food-queue-realtime')` to listen to all `requests` events.
  - Wrapped `fetchData` in `useCallback` with a mutable `fetchDataRef` ref so the subscription always executes the latest handler.
  - Wired `refreshTrigger` from `App.tsx` to instantly refresh `<FoodQueue>` upon dismissing incoming request alerts.
  - Added **instant optimistic UI updates** across all actions (Prepare, Order Ready, Edit Order Save, and Decline).

---

### 13. Actor Attribution & Role Resolution Fix (`apps/staff-app/components/RequestHistory.tsx`)

- **Root Cause of Inverted/Incorrect Actor Role Badges**:
  - When guests placed food orders via `/app/stay/dining/checkout`, the payload saved `booked_by: "Guest (Room 105)"`.
  - In `RequestHistory.tsx`, `resolveActorFromRequest` previously evaluated `name` using `payload.booked_by` before staff lookup, but evaluated `role` based on `req.claimed_by ? 'STAFF' : 'GUEST'`.
  - When staff claimed or modified an order, `claimed_by` became set, resulting in the card displaying `"Guest (Room 105)"` alongside the purple `🧑‍💼 STAFF` badge.
- **Resolution**:
  - Rewrote `resolveActorFromRequest`:
    1. If `req.claimed_by` is set, look up the UUID in `staffMap` to get the logged-in staff member's real name (e.g., `"John Staff"`) and assign role `'STAFF'`.
    2. If `req.claimed_by` exists but isn't found in `staffMap`, default to `"Front Desk Staff"` with role `'STAFF'`.
    3. If `req.claimed_by` is null (unclaimed request), derive the guest's name/room number and assign role `'GUEST'` (blue `📱 GUEST` badge).
  - Updated `resolveActorFromLog` to prevent guest name strings from being attached to `'STAFF'` role audit logs.
  - Passed `activeStaffUser` from `App.tsx` to `<FoodQueue>` so status updates, edits, and rejections record `activeStaffUser.full_name` in audit logs and update `last_modified_by` in the request payload.

---

### 14. Staff App Login Screen Polish & Remnants Cleanup (`apps/staff-app/App.tsx`)

- **Cleaned Up**:
  - Removed hardcoded pre-filled demo credentials (`frontdesk@demo.local / demo123456`) from `useState` initializers.
  - Removed the visible `demoBox` (demo credentials box) from the login card.
  - Removed outdated dev banner ("🚀 Phase 4 Active — Room Requests & Task Routing Loop") from the dashboard footer.
  - Cleaned up error messages and input placeholders to remove internal hints.
- **UI Enhancements**:
  - Added structured brand header above login card with hotel icon inside a gold accent ring (`🏨`), "Staff Portal" heading, and "Authorized access only" subtitle.
  - Enhanced input styling with deeper backgrounds, uppercase tracking labels, and stronger gold glow shadow on the primary submit button.

---

### 15. Customizable Spa Appointment Time Slots & Shift Scheduling (`/admin/spa`, `/app/stay/spa`, `SpaTimetable.tsx`)

- **Database Migration (`apps/web/supabase/migrations/15_spa_time_slots.sql`)**:
  - Creates `spa_time_slots` table with `slot_time`, `is_available`, `is_on_call`, `sort_order`, and `hotel_id`.
  - Configures RLS policies and enables realtime publication.
- **Admin Portal (`/admin/spa`)**:
  - Full CRUD management of appointment time slots.
  - 1-click availability toggling (`Active` vs `Disabled`) and on-call requirement toggling (`In-House` vs `On-Call`).
  - Inline / form edit capability and deletion with confirmation.
  - Quick-seed preset shortcuts for **Standard Day Shift (10:00 AM – 07:00 PM)** and **Late Night Shift (02:00 PM – 02:00 AM)**.
  - Realtime subscription to `spa_time_slots`.
- **Guest Booking Page (`/app/stay/spa`)**:
  - Dynamically loads active time slots (`is_available = true`) in configured sequence.
  - Realtime subscription on `spa_time_slots` ensures guest slots update immediately when modified or disabled by admin.
  - Graceful fallback to default slots when offline or unseeded.
- **Staff Master Timetable & Modals (`SpaTimetable.tsx`, `ManualSpaBookingModal.tsx`, `EditSpaBookingModal.tsx`)**:
  - `SpaTimetable.tsx` dynamically renders the timetable rows based on configured slots from `spa_time_slots`, supporting afternoon-to-midnight-to-early-morning shifts (e.g. 2:00 PM to 2:00 AM).
  - Automatically incorporates any unlisted appointment hours so late-night bookings are never hidden.
  - Booking modals mirror the dynamic slot list with 24-hour granular time pickers.

---

### Completed Database & Integration Items

- [x] ~~**Run migration `14_service_charge.sql`** on Supabase production instance to add the new columns (`service_charge_enabled`, `service_charge_pct`).~~ *(Applied to production ✅)*
- [x] ~~Apply pending Supabase migrations (`11_scheduled_booking_expiration.sql`, `13_menu_categories_and_storage.sql`) in target production Supabase database.~~ *(Applied to production ✅)*
- [x] ~~Phase 2 database reservation integrity work (atomic RPC, `request_id` FK on `spa_slot_locks`)~~ *(Completed in production ✅)*
- [x] ~~Integration test for atomic duplicate prevention~~ *(Completed ✅)*
- [x] ~~Apply migration `15_spa_time_slots.sql` in Supabase SQL editor for custom spa time slots.~~ *(Applied to production ✅)*
- [x] Apply migration `18_add_staff_users_push_token.sql` in Supabase SQL editor to enable native Android FCM push token storage on `staff_users`.

### Remaining Open Items

- Production multi-hotel RLS isolation test.

---

## Session Update — 2026-08-31 (Background Watchdog, Socket Recovery, Battery Optimization & FCM Dispatch)

### Overview
This session solved background sleeping, WebSocket disconnection, and out-of-sync states when Android devices are locked or in Doze mode in `staff-app`.

### Key Fixes & Additions
1. **24/7 Background Watchdog Engine (`apps/staff-app/lib/foregroundService.ts`)**:
   - Implemented `runBackgroundWatchdogCheck(hotelId)` which runs a direct HTTP REST query against Supabase every 90 seconds.
   - Operates 100% independently of WebSockets. If a new request is pending while the screen is off, it turns on the screen (`setTurnScreenOn`), acquires a 60s WakeLock, displays the Full-Screen Intent overlay, and loops the alarm sound.
2. **AppState Reconnection & Synchronization (`apps/staff-app/lib/useAutoSync.ts` & `App.tsx`)**:
   - Removed `Platform.OS === 'web'` restriction on socket reconnection.
   - On `AppState === 'active'` (screen unlock / app foregrounded), automatically disconnects and reconnects the Supabase Realtime channel (`rt.disconnect() -> rt.connect()`), and immediately refetches all stats, queues, and reminder popups.
3. **Battery Optimization Prompt (`apps/staff-app/lib/foregroundService.ts` & `App.tsx`)**:
   - Added `checkAndPromptBatteryOptimization()` to prompt staff to disable OEM battery optimization on login (`notifee.openBatteryOptimizationSettings()`).
4. **High-Priority FCM & Expo Push Dispatching (`apps/web/lib/webPush.ts`)**:
   - Updated token filter to accept all valid FCM and Expo push tokens.
   - Configured high priority flags (`priority: 'high'`, `sound: 'alarm'`, `channelId: 'hotel_staff_alarm'`, `ttl: 86400`) to wake sleeping Google Play Services devices.
5. **Database Migration 18 (`packages/supabase/migrations/18_add_staff_users_push_token.sql`)**:
   - Added `push_token` column to `staff_users` table so Android FCM device tokens persist properly on staff accounts.
   - Updated TypeScript types in `packages/supabase/types/index.ts` and `apps/staff-app/components/UserManagement.tsx`.

---

## Session Update — 2026-08-31 Part 2 (FOREGROUND_SERVICE_REMOTE_MESSAGING, Push Diagnostics & EAS Build Pipeline)

### Overview
This session implemented the Android 14+ OEM background survival fix (`FOREGROUND_SERVICE_REMOTE_MESSAGING`), built an end-to-end FCM High-Priority Push Testing & Diagnostics Suite across Web Admin and Staff Android App, and configured Firebase & EAS cloud build credentials.

### Key Additions & Changes
1. **Android 14+ Foreground Service Permission Fix (`apps/staff-app/app.json` & `foregroundService.ts`)**:
   - Added `"FOREGROUND_SERVICE_REMOTE_MESSAGING"` to `android.permissions` in `app.json`.
   - Declared `foregroundServiceTypes: [AndroidForegroundServiceType.REMOTE_MESSAGING, AndroidForegroundServiceType.DATA_SYNC]` in Notifee's `startStaffMonitoringService`.
   - Prevents Samsung OneUI / Xiaomi MIUI battery killers from terminating the background service after 15–30 minutes.
2. **Web Admin Push Diagnostics & 1-on-1 Test Dispatches (`/admin/users`)**:
   - Added "Device Push (FCM)" status column in staff users table (`📱 FCM Active` vs `⚠️ No FCM Token`).
   - Added 1-on-1 "⚡ Test Push" button per user and "⚡ Test FCM Push (All)" broadcast button in the toolbar.
   - Added interactive **Test Push Result Modal** displaying:
     - Exact token in Supabase (`ExponentPushToken[...]`, native FCM, or fallback).
     - Token type classification (`🟢 Real FCM Token`, `🟡 Local Fallback Token`, `⚠️ Token Missing`).
     - Expo/FCM delivery receipt tickets (`ticketId`, `status: ok`).
     - Reached devices count and detailed error/diagnostic logs.
3. **Staff Android App Push Diagnostics Modal (`apps/staff-app/components/PushDiagnosticsModal.tsx`)**:
   - Tappable `📡 FCM: OK` header button opens full diagnostics drawer.
   - 1-tap Token Copying, Service Status verification, and Live Push Receipts history log.
   - "🔔 Trigger Local Test Alarm" for instant audio, vibration, and full-screen intent verification on physical hardware.
   - Multi-strategy token resolution in `notifications.ts` (`getExpoPushTokenAsync` auto, with `projectId`, and native device token fallback).
4. **Firebase & EAS Build Pipeline**:
   - Configured `"googleServicesFile": "./google-services.json"` in `apps/staff-app/app.json`.
   - Configured `eas.json` with `buildType: "apk"` preview profile.
   - Verified building with `npx eas-cli build -p android --profile preview`.

---

## Session Update — 2026-08-31 Part 3 (Bug Fixes, EAS/Firebase Setup, FAB UI Improvement & Chat History)

### Overview
This session completed Firebase project initialization for the new `@johngegato` Expo account, fixed the hardcoded room number bug in `TaskQueue`, improved the FCM diagnostics button UI from an obstructive header button to a floating action button (FAB), and added a structured `chat-history/` directory for conversation recovery.

### Key Fixes & Additions

1. **TaskQueue Room Number Bug Fix (`apps/staff-app/components/TaskQueue.tsx`)**:
   - **Bug**: Room badge was hardcoded as the literal string `"Room 302"` regardless of the actual requesting room.
   - **Fix**: Updated Supabase query from `.select('*')` to `.select('*, rooms(room_number)')` to join the `rooms` table.
   - **Fix**: Added `rooms?: { room_number: string } | null` to the `TaskRequest` interface.
   - **Fix**: Replaced hardcoded text with `item.rooms?.room_number || item.payload?.room_number || item.room_id` with safe fallback chain.
   - **Commit**: `2dfe2f9`

2. **FCM Diagnostics Button UI Fix (`apps/staff-app/App.tsx`)**:
   - **Problem**: The `📡 FCM: OK` button was placed inside the header row alongside Sync and Logout, causing visual clutter and overlapping text on small screens.
   - **Fix**: Removed the FCM button from the header. Header now only shows `⚡ Sync` and `↩ Logout`.
   - **Added**: A new pill-shaped floating action button (FAB) anchored `position: 'absolute', bottom: 24, right: 20` — sits in the bottom-right corner of the screen, never overlaps content.
   - FAB shows `📡 FCM ✓` (with checkmark) when a real FCM token is registered, or `📡 FCM` when using a local fallback.
   - Styled with indigo glow shadow (`elevation: 8`, `shadowColor: '#6366f1'`).
   - **Commit**: `3663c52`

3. **Expo/Firebase Account Reset & EAS Credentials**:
   - Old project was linked to `kekehyu` account (old credentials) causing `Entity not authorized` errors.
   - Removed stale `extra.eas.projectId` and `owner` fields from `apps/staff-app/app.json`.
   - Re-initialized via `npx eas-cli project:init` under new `@johngegato` account.
   - New project: `@johngegato/staff-app` (ID: `4e2f24d0-60e3-4ce3-891e-1f2a1e591df6`).
   - FCM server key must be uploaded via `npx eas-cli credentials` → Android → FCM V1 / Google Service Account to resolve "Unable to retrieve FCM server key" Expo ticket error.
   - **Commit**: `cf09f2a`

4. **Security: `.gitignore` Updated**:
   - Added `*-firebase-adminsdk-*.json` and `*service-account*.json` patterns to prevent private Firebase service account keys from being committed to Git.

5. **Chat History Directory (`chat-history/`)**:
   - Created `chat-history/` folder in the repo root for storing AI agent conversation logs.
   - Added `README.md` explaining the directory purpose and naming convention.
   - Commit: current session.

### Files Modified This Session
| File | Change |
|------|--------|
| `apps/staff-app/components/TaskQueue.tsx` | Fixed hardcoded Room 302 → dynamic room join |
| `apps/staff-app/App.tsx` | FCM button moved from header to floating FAB |
| `apps/staff-app/app.json` | New EAS projectId (`4e2f24d0`), new owner (`johngegato`), `googleServicesFile` linked |
| `.gitignore` | Private Firebase admin key patterns excluded |
| `AGENT_HANDOFF.md` | Updated with this session |
| `AI_AGENT_CHECKLIST.md` | All items marked complete |
| `chat-history/README.md` | Chat history directory documentation |

### Current EAS Build Status
- **In progress**: `npx eas-cli build -p android --profile preview` under `@johngegato/staff-app`
- Once complete: Install APK on Android, sign in → device registers real `ExponentPushToken[...]` → Vercel admin `/admin/users` can push real FCM alarms across internet
- **Remaining credential step**: Upload Firebase Service Account JSON via `npx eas-cli credentials` → Android → FCM V1

### Next Steps for Incoming Agent
1. Verify the EAS Build completed (check [https://expo.dev/accounts/johngegato/projects/staff-app/builds](https://expo.dev/accounts/johngegato/projects/staff-app/builds))
2. Download and install the APK on the Android device
3. Upload FCM V1 Service Account key: `npx eas-cli credentials` in `apps/staff-app/`
4. Test push from `/admin/users` on Vercel — should show `🟢 Real FCM Token` and delivery `status: ok`
5. Multi-hotel RLS isolation test (still pending)


