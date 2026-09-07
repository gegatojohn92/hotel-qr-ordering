-- Migration 25: Live call queue enhancements and concurrency guards
-- Adds queue and claiming fields to requests table for LIVE_CALL requests

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS claimed_by_staff_id UUID REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_queue_position INTEGER DEFAULT 0;

COMMENT ON COLUMN public.requests.claimed_by_staff_id IS
  'Staff user UUID who claimed and answered the live call.';
COMMENT ON COLUMN public.requests.call_started_at IS
  'Timestamp when the call was answered by staff.';
COMMENT ON COLUMN public.requests.call_ended_at IS
  'Timestamp when the call was ended/dropped.';
COMMENT ON COLUMN public.requests.call_queue_position IS
  'Queue position index for pending live calls waiting to be answered.';

-- Index to optimize querying active/pending live calls per hotel
CREATE INDEX IF NOT EXISTS idx_requests_live_call_hotel_status
  ON public.requests (hotel_id, request_type, status)
  WHERE request_type = 'LIVE_CALL';
