# Feature Blueprint: Function Room Date-Range Booking + Guest Live Call Busy-Line UX

---

## 1. System Overview & Objectives

### Feature A — Function Room Multi-Day Date-Range Booking

Currently `function_room_bookings` stores a single `booking_date DATE` column alongside `start_time` and `end_time`. A 3-day event is impossible to express without creating multiple separate booking rows, causing data fragmentation, broken overlap detection, and confusing staff UX.

**Goal:** Add `booking_date_end DATE` to the schema so a single booking record can represent a date range (e.g., Sep 10–12). The overlap guard trigger must be extended to block cross-date conflicts. The staff-app `FunctionRoomModule` form and booking list must display and accept a date range. The payload synced into the `requests` table must carry both `booking_date` and `booking_date_end`.

### Feature B — Guest Live Call Busy-Line Redirect UX

Currently `OngoingCallNoticeModal` already shows when the line is busy, offering "Request Phone Callback Instead" and "Cancel & Return". The user wants this enhanced so that:
- If there is an **ongoing live call** by another guest, the modal shows both a **"Request Staff Callback"** button AND a **"Call Front Desk Directly"** (tel: dial) button as visible alternatives — not just a phone callback option.
- The wording is more actionable, making it clear these are the **two best paths** when the line is busy.
- Auto-retry when the line becomes free remains (already built via `subscribeToCallQueue`).

**This is a guest web (`apps/web`) only change** — the `OngoingCallNoticeModal.tsx` and `CallFrontDeskModal.tsx` need small UX additions. No native rebuild needed (OTA update only).

---

## 2. File Index & Scope

### Files to Modify

#### Database
| File | Change |
|---|---|
| `packages/supabase/migrations/26_function_room_date_range.sql` | **[NEW]** Add `booking_date_end` column, update overlap trigger |
| `packages/supabase/types/index.ts` | Regenerate to include `booking_date_end` field |

#### Staff App (Android) — requires full APK rebuild after migration
| File | Change |
|---|---|
| `apps/staff-app/components/FunctionRoomModule.tsx` | Add `booking_date_end` to types, form state, DEFAULT_FORM, form inputs, overlap check, submit payload, booking list display, edit modal pre-fill, audit log payloads |

#### Guest Web (Next.js) — OTA-safe (Vercel auto-deploy)
| File | Change |
|---|---|
| `apps/web/app/app/stay/components/OngoingCallNoticeModal.tsx` | Add "Call Front Desk Directly" (tel: link) button alongside callback option; update copy |
| `apps/web/app/app/stay/components/CallFrontDeskModal.tsx` | Pass `hotelPhone` down to `OngoingCallNoticeModal` so direct dial button works |

### New Files to Create
| File | Purpose |
|---|---|
| `packages/supabase/migrations/26_function_room_date_range.sql` | Schema migration adding `booking_date_end` column and updating overlap trigger |

### Dependencies / Packages
- No new npm packages required.
- **Staff-app** changes require a full `eas build` (schema/type changes consumed by native app JS bundle).
- **Guest web** changes are deploy-on-push to Vercel; no rebuild needed.

---

## 3. Step-by-Step Execution Checklist

### Phase 1 — Database Migration

- [x] **Task 1:** Create `packages/supabase/migrations/26_function_room_date_range.sql`:
  - `ALTER TABLE function_room_bookings ADD COLUMN IF NOT EXISTS booking_date_end DATE;`
  - Set default: `UPDATE function_room_bookings SET booking_date_end = booking_date WHERE booking_date_end IS NULL;`
  - Add NOT NULL constraint after backfill: `ALTER TABLE function_room_bookings ALTER COLUMN booking_date_end SET NOT NULL;`
  - Add CHECK: `ALTER TABLE function_room_bookings ADD CONSTRAINT chk_booking_date_range CHECK (booking_date_end >= booking_date);`
  - Drop and recreate `prevent_function_room_booking_overlap()` trigger function to check date range overlap (date ranges overlap when `NEW.booking_date <= b.booking_date_end AND NEW.booking_date_end >= b.booking_date`)
  - Add index: `CREATE INDEX IF NOT EXISTS idx_function_room_bookings_date_end ON function_room_bookings(booking_date_end);`

- [ ] **Task 2:** Apply migration to live Supabase via the Supabase dashboard SQL editor or `supabase db push`.

- [x] **Task 3:** Regenerate TypeScript types:
  ```bash
  npx supabase gen types typescript --linked > packages/supabase/types/index.ts
  ```

### Phase 2 — Guest Web: OngoingCallNoticeModal UX Enhancement

- [x] **Task 4:** Update `OngoingCallNoticeModal.tsx` props interface:
  - Add `hotelPhone?: string | null` to `OngoingCallNoticeModalProps`

- [x] **Task 5:** Update `OngoingCallNoticeModal.tsx` action buttons section:
  - Keep existing "Request Phone Callback Instead" button (primary CTA)
  - Add a second button: **"Call Front Desk Directly"** rendered as `<a href="tel:{hotelPhone}">` styled as a secondary button
  - Update the body copy: Change "Our front desk is currently speaking with another guest." to include "While you wait, you can request a callback or dial us directly."
  - If `hotelPhone` is null/undefined, hide the direct dial button gracefully

- [x] **Task 6:** Update `CallFrontDeskModal.tsx` to pass `hotelPhone` to `OngoingCallNoticeModal`:
  - `OngoingCallNoticeModal` is already rendered in `CallFrontDeskModal` — add `hotelPhone={hotelPhone}` prop to the component usage

- [ ] **Task 7:** Verify Vercel auto-deploys on push to `main`. Test in browser: open the modal, trigger busy-line state, confirm both buttons appear.

### Phase 3 — Staff App: FunctionRoomModule Date Range

- [x] **Task 8:** Update TypeScript type `FunctionRoomBooking` in `FunctionRoomModule.tsx`:
  - Add field: `booking_date_end: string`

- [x] **Task 9:** Update `BookingFormState` type:
  - Add field: `booking_date_end: string`

- [x] **Task 10:** Update `DEFAULT_FORM` constant:
  - Add: `booking_date_end: new Date().toISOString().slice(0, 10)` (same as `booking_date` by default = single day)

- [x] **Task 11:** Update `openEditModal` function to pre-fill `booking_date_end` from the booking record.

- [x] **Task 12:** Update `hasBookingOverlap` function to use date-range logic:
  - Old check: `booking.booking_date !== date`
  - New check: booking overlaps if `date <= booking.booking_date_end AND dateEnd >= booking.booking_date`

- [x] **Task 13:** Update `handleSubmit` validation:
  - Add validation: `if (form.booking_date_end < form.booking_date) { setError('End date must be on or after the start date.'); return; }`
  - Add `booking_date_end` to `bookingPayload` object sent to Supabase
  - Add `booking_date_end` to the `requests` table payload JSON (for audit and history)
  - Add `booking_date_end` to audit log `details` object

- [x] **Task 14:** Update booking form UI (inside `<Modal>` ScrollView):
  - Replace single date input with two inputs: **"Start Date (YYYY-MM-DD)"** and **"End Date (YYYY-MM-DD)"**
  - Add helper text: "For single-day bookings, set end date = start date"
  - Layout: two-column side-by-side (same pattern as `start_time`/`end_time`)

- [x] **Task 15:** Update booking list card display:
  - Change: `Date: {formatDateLabel(booking.booking_date)}` 
  - To: `Date: {formatDateLabel(booking.booking_date)}{booking.booking_date !== booking.booking_date_end ? ` – ${formatDateLabel(booking.booking_date_end)}` : ''}` 
  - (single day shows one date; multi-day shows a range)

- [x] **Task 16:** Update `renderFunctionBookingDetail` helper (used by `RequestHistory`):
  - Similarly update the Date row to show range if applicable

- [x] **Task 17:** Update `upcomingBookings` sort — keep existing sort by `booking_date` ascending, no change needed.

- [x] **Task 18:** Update the "next booking" summary box label to show date range if applicable.

### Phase 4 — Build & Deploy

- [x] **Task 19:** Push guest web changes to `main` → Vercel auto-deploys. Verify in browser.

- [ ] **Task 20:** Push staff-app changes, then build new APK:
  ```bash
  npx eas-cli build --platform android --profile production
  ```
  > IMPORTANT: A full rebuild is needed because TypeScript types from Supabase schema changed and the booking payload shape changed. OTA alone is insufficient for schema-driven type changes consumed in the app bundle.

- [ ] **Task 21:** After APK is distributed, push OTA update to `main` channel:
  ```bash
  npx eas-cli update --branch main --message "Function room date range + guest call busy UX"
  npx eas-cli channel:edit production --branch main
  ```

- [x] **Task 22:** Commit and push all changes:
  ```bash
  git add .
  git commit -m "feat: function room date-range booking + guest live call busy-line UX"
  git push origin main
  ```

---

## 4. Edge Cases & Safety Checks

### Database Safety
- **Migration is additive only** — `ADD COLUMN IF NOT EXISTS` will not break existing rows or in-flight queries.
- **Backfill before NOT NULL** — `booking_date_end` must be backfilled from `booking_date` before adding `NOT NULL` constraint, otherwise existing rows will fail.
- **Overlap trigger must be updated** — the existing trigger `trg_prevent_function_room_booking_overlap` currently only checks `booking_date = NEW.booking_date`. After migration it MUST be replaced to check date range overlap, or a 3-day booking starting Sep 10 would not block a Sep 12 single-day booking in the same room.
- **Check constraint order** — `chk_booking_date_range` must come after the NOT NULL constraint.

### Staff App Safety
- **Backward compatibility** — if old APK (without `booking_date_end` awareness) reads a record that now has this field, it simply ignores the unknown key. Safe.
- **Form validation** — enforce `booking_date_end >= booking_date` client-side before hitting Supabase to prevent the DB constraint from rejecting silently.
- **Overlap detection** — the `hasBookingOverlap` client-side check in `handleSubmit` must mirror the new DB trigger logic. If they diverge, the DB will still catch it as a fallback, but the UX error message will be generic.

### Guest Web Safety
- **`hotelPhone` null guard** — if `hotelPhone` is null (hotel has no phone configured), the "Call Directly" button must not render. An `href="tel:null"` link would be a broken experience.
- **No new Agora/WebRTC changes** — this feature only adds a UI button, does not touch call initiation logic. Zero risk to voice call stability.
- **OngoingCallNoticeModal is already mounted conditionally** — `showOngoingCallModal` flag in `CallFrontDeskModal` controls visibility. No changes to mounting logic needed.

### Supabase Realtime
- The existing `subscribeToCallQueue` in `OngoingCallNoticeModal` already auto-detects when the line becomes free and calls `onLineFree()`. This auto-retry behavior is preserved — no changes needed.

---

## 5. Verification & Testing Steps

### Database
```sql
-- After applying migration 26, verify column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'function_room_bookings'
  AND column_name IN ('booking_date', 'booking_date_end');

-- Test overlap trigger blocks cross-date conflict
-- (Run via Supabase SQL editor)
INSERT INTO function_room_bookings (..., booking_date, booking_date_end, start_time, end_time, status)
VALUES (..., '2026-09-10', '2026-09-12', '09:00', '18:00', 'CONFIRMED');
-- This should FAIL:
INSERT INTO function_room_bookings (..., booking_date, booking_date_end, start_time, end_time, status)
VALUES (..., '2026-09-11', '2026-09-11', '10:00', '14:00', 'PENDING');
```

### Guest Web (Browser)
1. Open guest web → Call Front Desk → click "Live Voice Call"
2. If another call is active → `OngoingCallNoticeModal` appears
3. Verify: **"Request Staff Callback"** button and **"Call Front Desk Directly"** button (tel: link) both visible
4. Click callback → modal closes and callback request is submitted
5. Click "Call Directly" → device prompts to open phone dialer with hotel number
6. Wait for line to free → modal auto-dismisses

### Staff App (Android)
1. Open Function Rooms → New Booking
2. Verify two date fields: **Start Date** and **End Date**
3. Set Start Date = `2026-09-10`, End Date = `2026-09-12` → save
4. Booking card shows: `Date: Wed, Sep 10 – Fri, Sep 12`
5. Try to create overlapping booking for same room on `2026-09-11` → client-side and DB both block it
6. Try single-day booking (start = end) → works normally
7. Try end date < start date → validation error before submit
