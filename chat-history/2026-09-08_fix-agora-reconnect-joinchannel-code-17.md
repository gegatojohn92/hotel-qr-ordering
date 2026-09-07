# 2026-09-08: Fix Agora Live Voice Call Reconnect Failure (joinChannel Code -17)

## Summary
Fixed an issue in `apps/staff-app` where consecutive incoming live calls from guests (or any re-dial after the guest hangs up) would fail on Answer with:
> `Call Failed : could not connect to live voice call. Agora joinChannel failed with code -17`

## Root Cause
1. **Missing Native Teardown on Remote Departure (`onUserOffline`)**:
   When a guest hung up from the web interface, the Agora event handler `onUserOffline` in `useStaffVoiceCall.native.ts` set `isConnected = false` and called `onCallEnded?.()`, but **never executed `engine.leaveChannel()` or `engine.release()` / `InCallManager.stop()`**.
2. **Zombie Channel Attachment in Android Memory**:
   `leaveChannel()` was only bound to the manual staff "End Call" button. If the guest hung up first, the native Agora RTC engine stayed attached to the previous channel in native Android memory.
3. **Agora RTC Code `-17` (`ERR_JOIN_CHANNEL_REJECTED`)**:
   When staff attempted to answer a subsequent call, Agora rejected `joinChannel` with code `-17` because the native engine was still in an active channel.
4. **No Pre-Join Sanitization**:
   `joinChannel` did not clean up lingering previous engine references prior to initialization.

## Key Changes
- **`apps/staff-app/lib/useStaffVoiceCall.native.ts`**:
  - Implemented centralized `cleanupEngine()` callback that stops `InCallManager`, unregisters event handlers, leaves the channel, releases the Agora engine, and resets state.
  - Added `await cleanupEngine()` to `onUserOffline` and `onError` handlers so remote guest hang-ups trigger complete native channel departure.
  - Added pre-flight `await cleanupEngine()` at the start of `joinChannel()` to ensure a clean state before joining any new channel.
  - Unified `leaveChannel()` and unmount lifecycle to use `cleanupEngine()`.
- **`apps/staff-app/lib/useStaffVoiceCall.web.ts`**:
  - Applied matching `cleanupClient()` parity on `user-left`, error, pre-join, and unmount.

## Deployment Notes
- **OTA-Safe**: These modifications are pure TypeScript hook logic in `apps/staff-app/lib/` (no native dependencies or `app.json` configuration changed).
- Deployable directly via EAS OTA updates:
  ```bash
  npx eas-cli update --branch main --message "Fix Agora live voice call reconnect joinChannel code -17"
  ```
