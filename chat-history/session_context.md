# Session Context — Branch: `backup-09-07-26-pm`
**Date:** 2026-09-07 | **Agent:** Antigravity

---

## 🏗️ Project Overview

**Hotel QR Ordering System** — A multi-app hospitality SaaS monorepo.

| App | Stack | Deployment |
|-----|-------|-----------|
| `apps/web` | Next.js 16 (App Router), React 19, TypeScript, Vanilla CSS | Vercel (`hotel-qr-ordering-system-web.vercel.app`) |
| `apps/staff-app` | Expo 54 / React Native 0.81.5, TypeScript | EAS Build (APK) + OTA via `expo-updates` → `expo.dev/@johngegato/staff-app` |
| `packages/supabase` | PostgreSQL migrations + shared TS types | Supabase (`bsjnlawhdgfilcfejbji.supabase.co`) |

**Live services:**
- 🌐 **Vercel** — Web app + API routes (Next.js)
- 🗄️ **Supabase** — PostgreSQL, Realtime, Storage, Auth
- 📱 **Expo / EAS** — Android APK (`johngegato/staff-app`, ID: `4e2f24d0-60e3-4ce3-891e-1f2a1e591df6`)
- 📞 **Agora RTC** — 2-way live voice calling (guest web ↔ staff app)

---

## ⚠️ Critical Rules Before ANY Modification

### 1. OTA vs. Full APK Rebuild
| Change | Action Required |
|--------|----------------|
| TypeScript/JS/TSX code, UI, Supabase queries, styling | ✅ OTA only: `npx eas-cli update --branch preview --message "..."` from `apps/staff-app/` |
| New native permissions in `app.json` | 🔴 Full rebuild: `eas build -p android --profile preview` |
| New native packages (Java/Kotlin/C++ bindings) e.g. `react-native-mmkv` | 🔴 Full rebuild required |
| New Expo plugins added to `app.json "plugins"` array | 🔴 Full rebuild required |
| `google-services.json` changes | 🔴 Full rebuild required |

### 2. Never Touch Production Env Vars / Supabase Config
- **DO NOT** modify `.env` files, Vercel environment variables, or Supabase connection strings
- Current Supabase project: `bsjnlawhdgfilcfejbji.supabase.co` (egress limits reached — migration guide in `chat-history/2026-09-04_supabase-account-migration-guide.md`)

### 3. Supabase Init Pattern (CRITICAL for web)
Always use the factory wrapper — **NEVER** call `createBrowserClient()` directly:
```ts
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
const supabase = createSupabaseBrowserClient()
```
Direct `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` causes **Vercel SSG prerender crash**.

### 4. Staff-App Build Safety Checks
Before pushing any staff-app change, verify:
```bash
# TypeScript check
cd apps/staff-app && npx tsc --noEmit

# Web export check (catches Expo-specific issues)
npx expo export --platform web
```

### 5. Catch Block Syntax
In staff-app files exported to web, use `catch (err)` not `catch (err: any)` — older Expo web toolchain may reject typed catch bindings.

---

## 📦 Staff-App Dependencies (Current)

```json
{
  "expo": "~54.0.37",
  "react-native": "0.81.5",
  "react": "19.1.0",
  "@supabase/supabase-js": "^2.112.2",
  "@notifee/react-native": "^9.1.8",
  "react-native-agora": "^4.6.2",
  "react-native-incall-manager": "^4.2.2",
  "expo-updates": "~29.0.20",
  "expo-notifications": "~0.32.17",
  "expo-av": "~16.0.8",
  "expo-haptics": "~15.0.8",
  "expo-secure-store": "~15.0.8",
  "agora-rtc-sdk-ng": "^4.24.8"
}
```
> ⚠️ `@notifee/react-native` and `react-native-agora` are **native packages** — adding new ones requires APK rebuild.

---

## 🗂️ Key Files Map

### Staff App
| File | Purpose |
|------|---------|
| `apps/staff-app/App.tsx` | Root — auth, RBAC, realtime routing, call lifecycle, OTA |
| `apps/staff-app/app.json` | Expo config, permissions, EAS, plugins |
| `apps/staff-app/eas.json` | EAS build profiles |
| `apps/staff-app/components/FoodQueue.tsx` | F&B orders queue + manual order creation |
| `apps/staff-app/components/SpaQueue.tsx` | Spa booking queue + approve/decline |
| `apps/staff-app/components/SpaTimetable.tsx` | Master spa timetable |
| `apps/staff-app/components/TaskQueue.tsx` | Housekeeping/maintenance tasks |
| `apps/staff-app/components/CallQueue.tsx` | Front desk call requests |
| `apps/staff-app/components/DedicatedCallModule.tsx` | Detailed call handler |
| `apps/staff-app/components/RequestHistory.tsx` | Full request audit history |
| `apps/staff-app/components/EditSpaBookingModal.tsx` | Edit spa bookings |
| `apps/staff-app/components/ManualSpaBookingModal.tsx` | Staff manual spa booking |
| `apps/staff-app/components/IncomingRequestAlert.tsx` | Incoming alert overlay |
| `apps/staff-app/components/IncomingLiveCallAlert.tsx` | Live voice call overlay |
| `apps/staff-app/components/ActiveCallBar.tsx` | Floating active call bar |
| `apps/staff-app/components/PushDiagnosticsModal.tsx` | FCM diagnostics |
| `apps/staff-app/lib/notifications.ts` | Push token, Android alarm channel |
| `apps/staff-app/lib/useAutoSync.ts` | Background polling + socket reconnect |
| `apps/staff-app/lib/useAutoUpdate.ts` | OTA update checker |
| `apps/staff-app/lib/useStaffVoiceCall.ts` | Agora RTC native hook |
| `apps/staff-app/lib/authStorage.ts` | Persistent auto-login |
| `apps/staff-app/lib/foregroundService.ts` | Android watchdog + battery optimization |

### Web App
| File | Purpose |
|------|---------|
| `apps/web/lib/supabase-browser.ts` | Safe browser Supabase client factory |
| `apps/web/app/api/agora/token/route.ts` | Agora RTC token server |
| `apps/web/app/api/push/webhook/route.ts` | DB webhook → FCM dispatch |
| `apps/web/app/admin/branding/page.tsx` | Dynamic theme CMS |
| `apps/web/app/admin/users/page.tsx` | Staff User Account Control |
| `apps/web/app/app/stay/components/GuestSettingsProvider.tsx` | Guest theme provider |

### Supabase
| Path | Purpose |
|------|---------|
| `packages/supabase/migrations/` | All SQL migrations (01–24) |
| `packages/supabase/types/index.ts` | Shared TypeScript DB types |

---

## 📋 Pending Items (from last session)

- [ ] **Supabase account migration** — current project egress exhausted. Guide: `chat-history/2026-09-04_supabase-account-migration-guide.md`
- [ ] Migrations 23 (`enable_guest_live_call`) + 24 (`theme_mode`, `theme_config`, `content_config`) not yet applied to production
- [ ] Upload Firebase FCM V1 Service Account JSON via `npx eas-cli credentials`
- [ ] Multi-hotel RLS isolation test (production)
- [ ] Apply DB migrations `15`, `16`, `18`, `19` in Supabase SQL editor (check which are applied)

---

## 🔄 Workflow for This Branch

1. **Make changes** on `backup-09-07-26-pm`
2. **Test locally** — run TypeScript checks + Expo web export for staff-app changes
3. **Assess deploy type** — OTA push OR APK rebuild (see table above)
4. **Document changes** — add entry to `chat-history/` and update `AGENT_HANDOFF.md`
5. **Merge to main** only after testing is confirmed ✅

---

## 📞 Agora RTC Architecture
- Guest Web: `GuestVoiceCallEngine.tsx` (UID=1), browser-based
- Staff App: `useStaffVoiceCall.ts` (UID=2), `react-native-agora` v4
- Token API: `apps/web/app/api/agora/token/route.ts` — must use absolute URL `https://hotel-qr-ordering-system-web.vercel.app/api/agora/token` (native can't use relative URLs)
- Channel ID stored in `requests.agora_channel` (Migration 21)

---

## 🔒 RBAC Roles
| Role | Staff App View |
|------|---------------|
| `ADMIN` / `MANAGER` | All queues |
| `FRONT_DESK` | Call requests, Tasks |
| `KITCHEN` | Food queue only |
| `SPA` | Spa queue + timetable |
| `HOUSEKEEPING` | Task queue |
