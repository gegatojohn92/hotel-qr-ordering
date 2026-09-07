# 2026-09-08: Function Room Booking Status Transitions, Active Filtering & Cancellation Modal

## Summary
Fixed three issues in the Staff App Function Room Booking module (`apps/staff-app/components/FunctionRoomModule.tsx`):
1. **Confirm Button / Card Updating**: Made booking action buttons status-aware so that when a `PENDING` booking is confirmed, the "Confirm" button transitions to "Complete" and the card updates immediately with optimistic state updates.
2. **Completed Items Filtering**: Excluded `COMPLETED` bookings from the upcoming active queue and added view filter tabs (**Active**, **Completed**, and **All**) so completed events move out of the active schedule.
3. **Cancellation Reason Modal**: Added a dedicated cross-platform React Native Cancellation Modal with preset quick-reason chips and multi-line text input to record reasons in notes and audit logs.

## Changes Made
- **`apps/staff-app/components/FunctionRoomModule.tsx`**:
  - Filtered `activeBookings` to only include `PENDING` and `CONFIRMED`.
  - Added `viewFilter` tabs: `Active (${activeBookings.length})`, `Completed (${completedBookings.length})`, `All (${bookings.length})`.
  - Enhanced `updateBookingStatus` with instant optimistic local state updates.
  - Made action buttons context-aware:
    - `PENDING`: Shows `✓ Confirm` and `✕ Cancel`.
    - `CONFIRMED`: Shows `✓ Complete` and `✕ Cancel`.
    - `COMPLETED`: Shows status badge without action buttons.
  - Added `cancelModalVisible`, `cancellingBooking`, and `cancellationReason` state with cancellation modal dialog.
  - Added dedicated color pill styles for `PENDING` (gold), `CONFIRMED` (green), `COMPLETED` (blue), and `CANCELLED` (red).

## Verification
- `npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json` passed with 0 errors.
- Verified OTA compatibility (pure TSX component changes, no native dependency changes).
