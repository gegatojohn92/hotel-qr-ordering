# 🚨 Production Deployment Rules & Agent Guide
> **MANDATORY**: Read this file at the start of every session before modifying any code in this repository.

---

## 1. ALWAYS Read These Files First (In Order)

Before making **any** modification or adding **any** new feature, you MUST review:

1. **`AGENT_HANDOFF.md`** — Full project context, architecture decisions, known issues, and prior work
2. **`AI_AGENT_CHECKLIST.md`** — Pre-flight checklist before writing or pushing any code
3. **`chat-history/`** — Session logs of previous changes; scan for relevant topics to avoid duplicate work or regressions
4. **`context.md`** — Overall system context and design decisions
5. **`PLAN.md`** (if present) — Current active implementation plan

> IMPORTANT: Do NOT skip reading `AGENT_HANDOFF.md` and `AI_AGENT_CHECKLIST.md`. They contain critical context about the live production system.

---

## 2. Live Production Stack — DO NOT Break These

This repository is **actively deployed in production**. Treat every change with the same care as a live system:

| Service | Platform | Notes |
|---|---|---|
| **Guest Web App** | Vercel | `apps/web` — Next.js, deployed on every push to `main` |
| **Database** | Supabase | PostgreSQL with RLS, real-time subscriptions, migrations in `packages/supabase/migrations/` |
| **Voice Calls** | Agora RTC | Token-based auth via `/api/agora/token`, Agora App ID in env vars |
| **Staff App (Android)** | expo.dev / EAS | `apps/staff-app` — React Native Expo, built via `eas build` |
| **OTA Updates** | EAS Update | JS-only changes pushed via `eas update --branch main` |
| **Push Notifications** | Firebase FCM | Configured via `google-services.json` in staff-app |

CAUTION: Never modify `.env` files, Supabase migration files already applied, or `app.json`/`eas.json` core config without fully understanding the downstream impact.

---

## 3. Staff-App (Android) — Special Rebuild Rules

WARNING: The staff-app is a **native Android APK**. Two categories of changes have very different deployment paths.

### When you MUST do a full `eas build` (APK rebuild):
- Adding or removing **native packages** (anything with `android/` or `ios/` folders)
- Changing **`app.json`** — package name, permissions, plugins, runtimeVersion
- Changing **`eas.json`** — build profiles
- Adding new **Expo plugins** (e.g., `expo-camera`, `expo-location`)
- Changing **native dependencies** in `package.json` (e.g., `react-native-agora`, `react-native-incall-manager`)

### When OTA update (`eas update`) is sufficient:
- UI/layout changes
- Business logic in `.tsx` / `.ts` files
- Adding new screens or components (no native APIs)
- Bug fixes to call logic, queue logic, etc.

### Build Commands:
```bash
# Full APK rebuild (takes ~10-15 min on EAS servers)
npx eas-cli build --platform android --profile production

# OTA JS-only update (fast, ~2-3 min)
npx eas-cli update --branch main --message "Description of change"
```

### After any OTA update, confirm channel is correct:
```bash
npx eas-cli channel:edit production --branch main
npx eas-cli channel:list
```

---

## 4. Before Modifying Staff-App — Dependency Check

Before making changes to `apps/staff-app`, always verify:

1. **Check current native dependencies** in `apps/staff-app/package.json`
2. **Verify if package is JS-only or native**:
   - Safe (JS only, OTA): `date-fns`, `zustand`, `react-query`, etc.
   - Unsafe (needs full rebuild): anything with `android/` dir or an Expo plugin declaration
3. **Check `eas.json` build profile** is correct before triggering a build
4. **Verify `runtimeVersion`** in `app.json` matches between build and update

---

## 5. Supabase Database Rules

CAUTION: Supabase is the live production database. Data loss or schema errors affect real hotel guests.

- **Never** run `DROP TABLE`, `TRUNCATE`, or broad `DELETE` without explicit user confirmation
- **Always** add new migrations as NEW files in `packages/supabase/migrations/` — never edit already-applied ones
- **Check `CHECK` constraints** before inserting new status values:
  - `requests_status_check` only allows: `PENDING`, `CLAIMED`, `RESOLVED`, `CANCELLED`
- **RLS policies** — any new table must have Row Level Security enabled with appropriate policies
- **Regenerate types** after schema changes:
  ```bash
  npx supabase gen types typescript --linked > packages/supabase/types/index.ts
  ```

---

## 6. Vercel (Guest Web) Deployment Rules

- `main` branch **auto-deploys** to Vercel on every push — be careful what you merge
- Environment variables are in the **Vercel dashboard** — do NOT hardcode secrets in code
- `vercel.json` at root controls routing — check before adding new API routes
- Test locally with `pnpm dev` in `apps/web` before pushing to `main`

---

## 7. Agora RTC — Voice Call Rules

- Agora credentials (`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`) live in Vercel env vars
- Token generation endpoint: `apps/web/app/api/agora/token/route.ts`
- Channel naming: `call-<requestId>` — must be consistent across guest web and staff-app
- Staff-app uses `react-native-agora`; guest web uses `agora-rtc-sdk-ng`
- Any change to Agora token logic requires testing both guest web AND staff-app

---

## 8. Git Branching Strategy

| Branch | Purpose |
|---|---|
| `main` | Production — auto-deploys to Vercel, OTA updates target this branch |
| `backup-YYYY-MM-DD` | Snapshot before major changes |
| Feature branches | Temporary, merge to `main` when complete |

Always create a backup before large-scale changes:
```bash
git checkout -b backup-YYYY-MM-DD
git push origin backup-YYYY-MM-DD
```

---

## 9. EAS Update Channel Mapping

| Channel | Branch | Purpose |
|---|---|---|
| `production` | `main` | What installed APKs receive OTA updates from |

Verify after every update push:
```bash
npx eas-cli channel:list
```

---

## 10. Quick Pre-Change Checklist

Before writing any code in this repo:
- [ ] Read `AGENT_HANDOFF.md`
- [ ] Read `AI_AGENT_CHECKLIST.md`
- [ ] Scan `chat-history/` for related prior sessions
- [ ] Confirm change type: OTA-safe OR needs full APK rebuild?
- [ ] Check Supabase `CHECK` constraints if touching any status fields
- [ ] Never touch `.env` / secrets without explicit user confirmation
- [ ] Create a `backup-<date>` branch if the change is large-scale
- [ ] Verify `production` EAS channel points to `main` after any update push
