# Chat History

This folder stores AI agent conversation summaries for the **Hotel QR Ordering System** project.

Each file represents a session or a group of related sessions with an AI coding assistant (Antigravity / Claude / Gemini).

---

## Purpose

- **Recovery**: If something breaks, scroll back to the relevant session log to understand what changed and why.
- **Context**: Future agents can read these to understand decisions made in past sessions without re-reading thousands of lines of code.
- **Audit trail**: Every meaningful architectural decision, bug fix, and feature addition is documented here alongside the Git commit SHA.

---

## Naming Convention

Files are named: `YYYY-MM-DD_topic-summary.md`

Examples:
- `2026-08-30_background-service-fcm-push.md`
- `2026-08-31_eas-build-firebase-setup.md`
- `2026-08-31_taskqueue-bug-fixes-fab-ui.md`

---

## Sessions Index

| Date | File | Topics Covered |
|------|------|----------------|
| 2026-08-30 | [2026-08-30_background-service-fcm-push.md](./2026-08-30_background-service-fcm-push.md) | Background watchdog, WebSocket reconnect, battery optimization, FCM push dispatch, DB migration 18 |
| 2026-08-31 | [2026-08-31_foreground-service-type-push-diagnostics.md](./2026-08-31_foreground-service-type-push-diagnostics.md) | FOREGROUND_SERVICE_REMOTE_MESSAGING fix, FCM diagnostics suite (web + app), multi-strategy token resolution |
| 2026-08-31 | [2026-08-31_eas-build-firebase-setup.md](./2026-08-31_eas-build-firebase-setup.md) | Firebase project setup, google-services.json, EAS credentials, account migration to @johngegato |
| 2026-08-31 | [2026-08-31_taskqueue-bug-fixes-fab-ui.md](./2026-08-31_taskqueue-bug-fixes-fab-ui.md) | TaskQueue room number bug fix, FCM button moved to floating FAB |
| 2026-08-31 | [2026-08-31_fnb-access-control-guest-dialing-manual-orders.md](./2026-08-31_fnb-access-control-guest-dialing-manual-orders.md) | F&B access control (KITCHEN RBAC), universal guest dialing, manual food orders, FnBDiningFAB, TaskQueue resolution fix |
| 2026-08-31 | [2026-08-31_automated-fcm-push-token-lifecycle-admin-settings.md](./2026-08-31_automated-fcm-push-token-lifecycle-admin-settings.md) | Automated DB-triggered FCM push, token lifecycle 1:1 binding & logout cleansing, role-based routing, alert deduplication, admin notification controls |
| 2026-08-31 | [2026-08-31_expo-updates-ota-configuration.md](./2026-08-31_expo-updates-ota-configuration.md) | EAS OTA auto-updates via `expo-updates`, launch & foreground auto-check hook, silent download & auto-restart |
| 2026-09-01 | [2026-09-01_agora-rtc-2way-voice-calling.md](./2026-09-01_agora-rtc-2way-voice-calling.md) | 2-Way Live Voice Calling between guest web and staff app via Agora RTC, Realtime signaling, and FCM push |
| 2026-09-04 | [2026-09-04_admin-branding-function-room-finalization.md](./2026-09-04_admin-branding-function-room-finalization.md) | Dynamic hotel branding from admin settings, compact mobile admin header, and final function room multi-room booking + audit trail work |
| 2026-09-04 | [2026-09-04_admin-toggle-guest-live-call-button.md](./2026-09-04_admin-toggle-guest-live-call-button.md) | Admin toggle to hide/show guest Live Voice Call button (migration 23 `enable_guest_live_call`, admin settings switch, guest modal gating) |
| 2026-09-04 | [2026-09-04_fix-staff-live-call-answer-failure.md](./2026-09-04_fix-staff-live-call-answer-failure.md) | Fixed staff-app "Call Failed" on Answer: absolute Vercel token URL for native fetch + react-native-agora v4 joinChannel signature + join success/error handlers |
| 2026-09-04 | [2026-09-04_dynamic-theme-content-cms.md](./2026-09-04_dynamic-theme-content-cms.md) | Dynamic Theme & Content CMS: migration 24 (`theme_mode`, `theme_config`, `content_config` on `hotels`), admin branding page (`/admin/branding`), guest web provider + realtime sync, WCAG contrast checks |
| 2026-09-04 | [2026-09-04_guest-qr-resilience-fix.md](./2026-09-04_guest-qr-resilience-fix.md) | Fixed "Invalid QR Code" crash on guest web: split theme fetch from room validation so missing migration 24 columns don't break QR access |
| 2026-09-04 | [2026-09-04_supabase-account-migration-guide.md](./2026-09-04_supabase-account-migration-guide.md) | **PENDING** — Step-by-step guide for migrating to a new Supabase account (egress limits reached). Includes data export, new project setup, code updates, and verification steps. |
| 2026-09-08 | [2026-09-08_fix-agora-reconnect-joinchannel-code-17.md](./2026-09-08_fix-agora-reconnect-joinchannel-code-17.md) | Fixed Agora live call reconnect error `-17` (`ERR_JOIN_CHANNEL_REJECTED`) on staff-app: centralized native/web engine teardown on `onUserOffline`, `onError`, and pre-join. |
| 2026-09-08 | [2026-09-08_function-room-status-actions-cancel-modal.md](./2026-09-08_function-room-status-actions-cancel-modal.md) | Fixed function room status buttons, excluded completed items from upcoming list, added Active/Completed/All filter tabs, and added Cancel Reason text input modal. |

---

## OTA Updates Reference (How to Publish Updates)

### 1. Publishing an Over-The-Air Update via EAS CLI
To deploy code, styling, UI, or bug fixes directly to staff devices without rebuilding the APK:

```bash
# Navigate to staff-app directory
cd apps/staff-app

# Publish update to the preview branch (or production branch)
npx eas-cli update --branch preview --message "Description of changes"
```

### 2. How Staff Devices Apply Updates
1. **On App Launch / Foreground Resume**: `useAutoUpdate()` checks EAS servers automatically.
2. **Silent Download**: New JavaScript bundles and assets download in the background.
3. **Prompt & Restart**: A dialog *"🔄 Update Ready — Restarting now to apply the latest features"* appears, and the app reloads with the latest code.

### 3. OTA Update vs. Full APK Rebuild Decision Matrix

| Scenario | OTA Update (`eas update`) | Rebuild APK (`eas build -p android`) |
| :--- | :---: | :---: |
| **Bug fixes in React Native / TypeScript code** | ✅ **Yes (Instant)** | ❌ No |
| **Adding or modifying UI screens, components, queues** | ✅ **Yes (Instant)** | ❌ No |
| **Styling, theme colors, CSS layout changes** | ✅ **Yes (Instant)** | ❌ No |
| **Modifying Supabase queries & API endpoints** | ✅ **Yes (Instant)** | ❌ No |
| **Adding new native Android permissions in `app.json`** | ❌ No | ✅ **Rebuild Required** |
| **Adding new native Android packages with native code (Java/C++/Gradle)** | ❌ No | ✅ **Rebuild Required** |

---

## How to Add a New Entry

1. Create a new `.md` file using the naming convention above.
2. Add a one-line entry to the Sessions Index table above.
3. Commit with message: `docs: add chat history for YYYY-MM-DD session`

