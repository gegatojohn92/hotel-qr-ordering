# Bug Diagnosis & Fix Plan

## 1. Root Cause Analysis

### Trigger
When a guest opens the chat drawer on `/app/stay` and sends a message (or when the widget initializes on page load), the browser console immediately reports:
1. `400 (Bad Request)` on Supabase PostgREST queries.
2. Multiple `/api/chat/send:1 Failed to load resource: the server responded with a status of 500 ()` errors each time a message is submitted.

### Faulty Code Path
1. **`apps/web/app/app/stay/components/GuestChatWidget.tsx` (`loadConversation()`, lines 195–215)**:
   - Queries `supabase.from('guest_conversations').select('*').eq('session_id', activeSessionId)`.
   - Because the live Supabase database table `guest_conversations` does not have the `session_id` column yet, PostgREST rejects the query with HTTP 400:
     `{"code":"42703", "message":"column guest_conversations.session_id does not exist"}`.
2. **`apps/web/app/api/chat/send/route.ts` (lines 6–18, 25–40, 65–85)**:
   - **Credential Fragility (lines 6–7)**:
     `const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!`
     `const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!`
     If `NEXT_PUBLIC_SUPABASE_URL` is undefined at runtime, `createClient(supabaseUrl, supabaseKey)` crashes before connecting. Unlike `apps/web/lib/supabase.ts` and `apps/web/lib/webPush.ts`, there is no fallback URL/key.
   - **Query Breakdown (lines 25–40)**:
     Attempts `.select('id, status, guest_phone').eq('session_id', session_id)`. PostgREST returns error 400 since neither column exists yet, setting `existing` to `null`.
   - **Insert Breakdown (lines 65–85)**:
     ```typescript
     const { data: newConv, error: convErr } = await supabase
       .from('guest_conversations')
       .insert({
         hotel_id,
         room_id,
         session_id: session_id || null,
         guest_phone: effectivePhone || null,
         status: 'BOT_ACTIVE',
         ...
       })
       .select('id, status')
       .single()

     if (convErr || !newConv) {
       return NextResponse.json({ error: convErr?.message || 'Failed to create conversation' }, { status: 500 })
     }
     ```
     PostgreSQL rejects the insert with `column "session_id" of relation "guest_conversations" does not exist` (or foreign key violation if `session_id` is invalid). The route catches this and responds with **HTTP 500**.
3. **Database Migration State**:
   - `packages/supabase/migrations/28_guest_chat_session_and_phone.sql` was added to the git repository in the previous commit, but has not yet been executed in the live Supabase database project (`https://bsjnlawhdgfilcfejbji.supabase.co`).
   - Verified via direct probe:
     `column guest_conversations.session_id does not exist` (PostgreSQL error code `42703`).

### Why it Failed
1. **Schema Mismatch**: The backend code and frontend client query columns (`session_id` and `guest_phone`) that do not exist in the active Supabase PostgreSQL database schema.
2. **Zero Schema Tolerance / Lack of Fallback**: `apps/web/app/api/chat/send/route.ts` treated `session_id` and `guest_phone` as hard prerequisites on insert and update. When Postgres reported column `42703`, the route failed completely with HTTP 500 instead of attempting a resilient insert of the core conversation fields.
3. **Hard Fail on Client Query**: `GuestChatWidget.tsx` did not handle PostgREST column errors gracefully with a fallback query, surfacing the 400 error directly into the console.

---

## 2. Proposed Fix

### Files to Modify
1. **Database Schema (Supabase SQL Editor / CLI)**:
   - Execute migration `28_guest_chat_session_and_phone.sql` against the active Supabase database.
2. **`apps/web/app/api/chat/send/route.ts`**:
   - Add default Supabase URL & Key fallbacks matching `apps/web/lib/supabase.ts`.
   - Implement **Schema-Resilient Conversation Lookup**: If lookup with `session_id` / `guest_phone` fails or errors, fall back to baseline `id, status` lookup by `hotel_id` and `room_id`.
   - Implement **Schema-Resilient Conversation Insert**: Attempt insert with `session_id` and `guest_phone`. If `convErr` occurs due to missing columns or foreign key mismatch, immediately fall back to inserting with baseline fields (`hotel_id`, `room_id`, `status`, `guest_name`, `last_message_*`).
   - Implement **Schema-Resilient Update**: If update with `session_id`/`guest_phone` fails, fall back to baseline conversation update.
3. **`apps/web/app/app/stay/components/GuestChatWidget.tsx`**:
   - Wrap `loadConversation()` with error-aware fallback: if querying with `.eq('session_id', activeSessionId)` returns an error (such as column does not exist), seamlessly fall back to loading the conversation without the `session_id` filter.
4. **`apps/web/app/api/chat/handoff/route.ts`**:
   - Add Supabase credentials fallback and safe `guest_phone` select fallback.

### Fix Strategy
- **Layer 1: Resilient Graceful Degradation in Code**:
  Make the Next.js API routes and React widget 100% resilient to database schema variations. If `session_id` or `guest_phone` columns are missing or schema cache is stale, the chat widget and AI assistant will continue working normally without throwing 400 or 500 errors.
- **Layer 2: Database Schema Synchronization**:
  Provide the exact SQL commands to run in Supabase SQL editor:
  ```sql
  ALTER TABLE public.guest_conversations ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL;
  ALTER TABLE public.guest_conversations ADD COLUMN IF NOT EXISTS guest_phone TEXT;
  CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id ON public.guest_conversations(session_id);
  CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone ON public.guest_conversations(guest_phone);
  ```

### Regression Risks
- **Very Low**: The fix introduces defensive try/catch and fallback logic. When columns exist, it uses full session isolation and phone tracking. When columns are absent, it degrades cleanly to the previous stable baseline behavior instead of crashing.

---

## 3. Verification Checklist
- [x] Task 1: Update `apps/web/app/api/chat/send/route.ts` with credential fallbacks and resilient conversation upsert logic.
- [x] Task 2: Update `apps/web/app/app/stay/components/GuestChatWidget.tsx` with resilient `loadConversation()` fallback query.
- [x] Task 3: Update `apps/web/app/api/chat/handoff/route.ts` with credential fallbacks and safe phone retrieval.
- [x] Task 4: Run build & TypeScript check (`npx -p typescript tsc --noEmit -p apps/web/tsconfig.json`).
- [x] Task 5: Execute database migration SQL in Supabase and verify column presence with Node test script.
- [x] Task 6: Test sending guest chat message and verify AI bot auto-replies with 200 OK.
