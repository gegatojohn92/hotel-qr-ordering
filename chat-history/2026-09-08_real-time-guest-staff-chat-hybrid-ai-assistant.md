# 2026-09-08: Real-Time Guest & Staff Chat with Hybrid AI Assistant

## Summary
Implemented an end-to-end, bi-directional real-time chat architecture connecting hotel guests on `apps/web` with hotel staff on `apps/staff-app`. The system integrates a Hybrid AI Assistant (powered by Gemini Flash with rule-based fallback) for instant concierge answers, seamless human escalation with push notifications, and AI smart reply suggestions for staff.

## Architecture & Data Flow
1. **Database & Realtime (`packages/supabase`)**:
   - `guest_conversations`: Tracks conversation state (`BOT_ACTIVE`, `STAFF_HANDOFF`, `RESOLVED`), unread counters, assigned staff, and latest message metadata.
   - `guest_chat_messages`: Immutable log of messages with sender types (`GUEST`, `AI`, `STAFF`, `SYSTEM`).
   - Realtime enabled on both tables via `supabase_realtime` publication.
2. **AI Concierge & Endpoints (`apps/web`)**:
   - `apps/web/lib/ai-assistant.ts`: System prompt with full hotel policy knowledge, Gemini Flash REST API integration, and comprehensive rule fallback covering FAQs, amenities, hours, and escalation intent detection.
   - `/api/chat/send`: Ingests messages, triggers AI automated responses when `BOT_ACTIVE`, or sends FCM push notifications to Front Desk when `STAFF_HANDOFF`.
   - `/api/chat/handoff`: Locks status to `STAFF_HANDOFF`, logs system audit message, and notifies staff.
   - `/api/chat/resolve`: Closes active chat, resets unread badges, and sends closure notification.
   - `/api/chat/ai-smart-replies`: Analyzes recent chat history and suggests 3 contextual quick-replies for staff.
3. **Guest Web Experience (`apps/web`)**:
   - `GuestChatWidget.tsx`: Persistent floating action button (FAB) with live unread badge, glassmorphic expandable drawer, Gold guest bubbles, Dark bot bubbles, Indigo staff bubbles, typing indicators, and quick-prompt chips.
   - Mounted globally across concierge routes via `StayRootClientWrapper.tsx`.
4. **Staff App Queue & Active Chat (`apps/staff-app`)**:
   - `GuestChatModule.tsx`: Queue list split into Active Handoffs, AI Bot Managed, and Resolved tabs with live unread counts.
   - `ActiveChatScreen.tsx`: Full-screen staff chat view with real-time stream, 1-tap claim/resolve actions, and AI Smart Reply chips.
   - Integrated into `App.tsx` navigation grid, dashboard stats, and push notification tap routing.

## Verification
- TypeScript compilation (`tsc`) passed with 0 errors across both `apps/web` and `apps/staff-app`.
- Verified AI assistant intent detection, FAQ rules, and smart reply generator.
