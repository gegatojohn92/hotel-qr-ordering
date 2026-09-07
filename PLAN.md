# Feature Blueprint: Live Voice Call Enhancement & Queue System

## 1. System Overview & Objectives
- **Current State Analysis**:
  - **Guest Web (`CallFrontDeskModal.tsx` & `GuestVoiceCallEngine.tsx`)**:
    - Guests initiate calls via Agora RTC channel (`room-{roomId}-{timestamp}`) with UID=1.
    - Permissions: `AgoraRTC.createMicrophoneAudioTrack()` is called directly inside `useGuestVoiceCall` without pre-flight permission checks or graceful handling for rejected microphone access.
    - Multiple callers: If multiple guests call simultaneously, separate channels and requests are generated indiscriminately. No active call detection or queuing mechanism exists on the guest UI.
    - Hangup / Cleanup: Guest relies on polling or Supabase realtime updates (`status === 'RESOLVED'`) to trigger `voiceCall.endCall()`. If staff drops or client disconnects abruptly, the WebRTC session or room state can linger.
  - **Staff App (`App.tsx`, `useStaffVoiceCall.native.ts` / `.web.ts`, `IncomingLiveCallAlert.tsx`, `ActiveCallBar.tsx`)**:
    - Incoming calls: Handled via push notification listeners and realtime listener (`requests` table `INSERT` where `request_type === 'LIVE_CALL'`).
    - Multiple callers: Single state `incomingLiveCall` holds only the latest call object (`{ requestId, roomNumber, channel }`). A second incoming call clobbers the first or leads to race conditions. If staff is already active on a call (`activeCallRoom !== null`), incoming calls can still pop up over the interface.
    - Dropping & Cleanup: Ending a call calls `leaveChannel()` and updates the request to `RESOLVED`. However, if staff drops the call or disconnects, Agora user-left events or atomic DB status transitions must immediately instruct the guest web engine to tear down its local audio track and client connection.
- **Objectives**:
  1. **Strict Microphone Permission Gate on Guest Web**: Implement pre-flight permission checks with an aggressive, user-friendly instructional modal/banner if permission is denied/blocked or needs to be accepted before initiating WebRTC.
  2. **Active Call & Queue Management**:
    - Guest Web: Check if there is already an ongoing or claimed live call for the hotel/room before initiating. Provide a clear modal/notice indicating an ongoing call is in progress and prompt the guest to wait.
    - Staff App: Transition from a single `incomingLiveCall` to an `incomingCallQueue` array with FIFO priority. When staff is already on a call (`activeCallRoom !== null`), suppress intrusive popup alerts and show a queued call badge/indicator in `ActiveCallBar`.
  3. **Immediate & Bidirectional Call Termination**:
    - When staff drops/hangs up a call, immediately propagate `RESOLVED` / `CALL_ENDED` status via Supabase Realtime broadcast or postgres changes, and handle Agora `user-left` / `user-offline` events on Guest Web to immediately terminate the guest session and close local microphone tracks.
    - On Guest Web tab close, refresh, or modal dismissal, send cleanup beacon/realtime update so staff app immediately knows the guest left.
  4. **Multi-Caller Race Condition Prevention**:
    - Atomic claiming of live call requests (`status = 'CLAIMED'` or `claimed_by_staff_id`) in Supabase so two staff members answering simultaneously do not join duplicate sessions.

---

## 2. File Index & Scope

### Files to Modify
- `apps/web/app/app/stay/components/CallFrontDeskModal.tsx`:
  - Integrate pre-flight microphone permission checks and error handling.
  - Check active calls in the hotel prior to dispatching new `LIVE_CALL` requests.
  - Add UI states for: `WAITING_IN_QUEUE`, `MIC_PERMISSION_DENIED`, `STAFF_BUSY`.
  - Handle `DECLINED` and `RESOLVED` realtime status to auto-close/teardown guest Agora connection immediately.
  - Add window `beforeunload` / unmount listeners to abort active call requests if guest closes tab.
- `apps/web/app/app/stay/components/GuestVoiceCallEngine.tsx`:
  - Expose connection state, mic track error states, and remote user event handlers.
  - Listen for remote user offline (`client.on('user-left')`) to immediately release audio tracks and invoke `endCall()` on guest side.
  - Add proper unmount cleanup and track release.
- `apps/staff-app/App.tsx`:
  - Convert `incomingLiveCall` single state into a managed queue array (`incomingCallQueue`).
  - Introduce busy-guard: when `activeCallRoom !== null`, incoming calls are queued without showing full-screen blocking alerts.
  - Enhance `handleAnswerLiveCall` with atomic update check to prevent race conditions across multiple staff devices.
  - Enhance `handleEndStaffCall` to ensure channel departure and broadcast call-end signal to guest.
- `apps/staff-app/components/IncomingLiveCallAlert.tsx`:
  - Support displaying queue indicators (e.g., "1 of X callers waiting").
- `apps/staff-app/components/ActiveCallBar.tsx`:
  - Add badge/indicator for pending queued callers while staff is actively talking.
- `apps/staff-app/lib/useStaffVoiceCall.native.ts` & `apps/staff-app/lib/useStaffVoiceCall.web.ts`:
  - Ensure Agora event handlers (`onUserOffline`, `onError`, `leaveChannel`) safely notify listeners and clear audio resources.
- `apps/web/app/api/agora/token/route.ts`:
  - Validate role and channel parameters, and add token generation safety checks.

### New Files to Create
- `apps/web/app/app/stay/components/MicPermissionModal.tsx`:
  - Interactive overlay / modal prompting guest to grant microphone access, with browser-specific guidance (Chrome/Safari/Edge/iOS).
- `apps/web/app/app/stay/components/OngoingCallNoticeModal.tsx`:
  - Modal notifying guest that another call is currently in progress, with real-time status updates/waiting queue position.
- `apps/web/lib/callQueueService.ts`:
  - Utility functions for checking active hotel live calls, querying queue positions, and subscribing to status transitions.
- `packages/supabase/migrations/25_live_call_queue_enhancements.sql`:
  - SQL migration to add optional queue tracking fields (`claimed_by_staff_id`, `call_started_at`, `call_ended_at`, `call_queue_position`) on `requests`.

### Dependencies / Packages
- **No new external npm packages required**.
  - Guest Web utilizes existing `agora-rtc-sdk-ng` and standard Web Audio/MediaDevices APIs (`navigator.mediaDevices.getUserMedia`).
  - Staff App utilizes existing `react-native-agora`, `react-native-incall-manager`, and `@supabase/supabase-js`.

---

## 3. Step-by-Step Execution Checklist

### Phase 1: Database & Shared Types
- [x] Task 1.1: Create `packages/supabase/migrations/25_live_call_queue_enhancements.sql` with schema modifications:
  - Add `claimed_by_staff_id` (UUID) to `requests` table.
  - Add indices for `status IN ('PENDING', 'LIVE') AND request_type = 'LIVE_CALL'` to quickly check active calls per hotel.
- [x] Task 1.2: Update `packages/supabase/types/index.ts` to reflect the extended fields on `requests`.

### Phase 2: Guest Web - Permissions & Active Call / Queue State
- [x] Task 2.1: Implement `apps/web/lib/callQueueService.ts`:
  - Functions: `checkActiveHotelCall(hotelId: string)`, `subscribeToCallQueue(hotelId: string, callback: (queueData: any) => void)`.
- [x] Task 2.2: Create `apps/web/app/app/stay/components/MicPermissionModal.tsx`:
  - Render a clear instruction card explaining why microphone access is mandatory for front-desk voice calls.
  - Provide a "Grant Microphone Permission" CTA triggering `navigator.mediaDevices.getUserMedia({ audio: true })`.
  - Provide instructions for unblocking microphone settings if the user previously tapped "Block".
- [x] Task 2.3: Create `apps/web/app/app/stay/components/OngoingCallNoticeModal.tsx`:
  - Render an informative waiting screen when front desk is already engaged on a live voice call.
  - Listen via Supabase Realtime to alert the guest as soon as the line becomes free or staff claims their call.
- [x] Task 2.4: Update `apps/web/app/app/stay/components/GuestVoiceCallEngine.tsx`:
  - Add listener for `user-left` (staff disconnected/hung up) to trigger immediate local teardown: stop local tracks, call `client.leave()`, and invoke `onStaffLeft()`.
  - Add listener for `connection-state-change` to detect dropouts and report connection failures.
- [x] Task 2.5: Update `apps/web/app/app/stay/components/CallFrontDeskModal.tsx`:
  - Before starting live voice call, execute pre-flight check via `navigator.permissions` or `getUserMedia`. If not granted, display `MicPermissionModal`.
  - Check `checkActiveHotelCall`: if an active call is ongoing, display `OngoingCallNoticeModal` or queue notice.
  - Hook `onStaffLeft` from `GuestVoiceCallEngine` to set status to `VOICE_ENDED` immediately and unmount audio tracks.
  - Attach `beforeunload` listener to set request status to `CANCELLED` / `RESOLVED` if user closes tab mid-call.

### Phase 3: Staff App - Call Queue, Busy Guard & Teardown
- [x] Task 3.1: Update `apps/staff-app/App.tsx`:
  - Change `incomingLiveCall` single state to `incomingCallQueue` array.
  - Realtime and push listeners append new incoming `LIVE_CALL` requests to `incomingCallQueue` without overriding existing entries.
  - Implement busy guard: if `activeCallRoom !== null`, do not render `IncomingLiveCallAlert` modal; instead, keep in queue and display indicator on `ActiveCallBar`.
  - In `handleAnswerLiveCall`: perform atomic update `UPDATE requests SET status = 'LIVE', claimed_by_staff_id = activeStaffUser.id WHERE id = reqId AND status = 'PENDING'`. If zero rows updated, inform staff that the call was answered by another agent and dequeue.
  - In `handleEndStaffCall`: leave Agora channel, update request status to `RESOLVED`, clear active call state, and if `incomingCallQueue` has remaining callers, surface the next caller alert.
- [x] Task 3.2: Update `apps/staff-app/components/ActiveCallBar.tsx`:
  - Add prop `queuedCallsCount: number`.
  - When `queuedCallsCount > 0`, render a pulsating badge (e.g., `📞 +1 Waiting`).
- [x] Task 3.3: Update `apps/staff-app/components/IncomingLiveCallAlert.tsx`:
  - Show queue index / waiting count if multiple requests are present.
- [x] Task 3.4: Review and verify `useStaffVoiceCall.native.ts` & `useStaffVoiceCall.web.ts`:
  - Ensure `leaveChannel()` consistently stops `InCallManager` and releases the Agora engine without unhandled rejections.

---

## 4. Edge Cases & Safety Checks
- **Microphone Permission Denied / Browser Settings Blocked**:
  - Web browsers (Chrome, Safari, Firefox) do not allow re-prompting `getUserMedia` once the user clicks "Block". The `MicPermissionModal` must provide exact visual instructions on how to click the site settings / lock icon in the URL bar to enable microphone.
- **Race Condition Between Multiple Staff Answering**:
  - Handled via conditional SQL update in Supabase (`WHERE id = ? AND status = 'PENDING'`). Only the first staff member to successfully claim will join Agora UID=2; others receive a notification and their queue entry is cleared.
- **Ghost Calls / Orphaned Channels**:
  - If a guest closes the browser tab or loses network connectivity during a call, the Agora client triggers `user-left` on staff side within seconds, prompting automatic hangup and DB update.
  - If staff app crashes or force-quits, Agora guest engine triggers `user-left` within Agora timeout (15–30s) and automatically tears down the guest mic track.
- **Multiple Guests Calling Concurrently**:
  - Guests receive the `OngoingCallNoticeModal` rather than being dropped or creating colliding channels.
  - Queue prioritization allows staff to finish current conversation before answering subsequent waiting guests.
- **Build & Deployment Safety**:
  - No new native dependencies added to `apps/staff-app/package.json` to prevent EAS build breakages.
  - All changes to `apps/staff-app` are JavaScript/TypeScript and compatible with standard OTA (`npx eas-cli update`).
  - Strict TypeScript validation (`tsc --noEmit`) must be executed for both `apps/web` and `apps/staff-app`.

---

## 5. Verification & Testing Steps
1. **Microphone Permission Verification (Guest Web)**:
   - In browser settings, set Microphone to "Ask" or "Block".
   - Open guest stay portal (`/app/stay`), click "Front Desk", then click "Live Voice Call".
   - Verify that `MicPermissionModal` is triggered. Grant permission, verify that Agora initializes smoothly.
   - Set Microphone to "Block", verify instructional modal explains how to reset site permissions.
2. **Concurrent Call / Queue Verification**:
   - Open two distinct guest browser sessions (Room A and Room B).
   - Initiate Live Voice Call from Room A. Staff app receives incoming call alert and answers.
   - From Room B, attempt Live Voice Call. Verify Room B displays the `OngoingCallNoticeModal` informing them of the active call and prompting them to wait.
   - Verify Staff App `ActiveCallBar` displays the queued caller badge.
3. **Call Teardown & Dropping Verification**:
   - While Room A and Staff are in an active call, tap "End Call" on Staff App.
   - Verify Room A immediately displays "Call Ended", closes the Agora channel, and releases the microphone indicator in the browser tab.
   - Repeat test with Room A hanging up; verify Staff App immediately closes call and updates request status.
4. **Codebase & Type Check Validations**:
   - Run in web workspace: `pnpm --filter @hotel-qr/web exec tsc --noEmit`
   - Run in staff-app workspace: `npx -p typescript tsc --noEmit -p apps/staff-app/tsconfig.json`
   - Verify export: `cd apps/staff-app && npx expo export --platform web`
