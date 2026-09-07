-- ============================================================
-- Migration 26: Function Room Multi-Day Date Range Booking
-- Adds booking_date_end to support date-range bookings
-- (e.g., a 3-day conference from Sep 10 to Sep 12)
-- ============================================================

-- Step 1: Add booking_date_end column (nullable first, so existing rows don't fail)
ALTER TABLE public.function_room_bookings
  ADD COLUMN IF NOT EXISTS booking_date_end DATE;

-- Step 2: Backfill existing single-day bookings (booking_date_end = booking_date)
UPDATE public.function_room_bookings
SET booking_date_end = booking_date
WHERE booking_date_end IS NULL;

-- Step 3: Now enforce NOT NULL (all rows are filled)
ALTER TABLE public.function_room_bookings
  ALTER COLUMN booking_date_end SET NOT NULL;

-- Step 4: Add CHECK constraint to ensure end date >= start date
ALTER TABLE public.function_room_bookings
  DROP CONSTRAINT IF EXISTS chk_booking_date_range;

ALTER TABLE public.function_room_bookings
  ADD CONSTRAINT chk_booking_date_range
  CHECK (booking_date_end >= booking_date);

-- Step 5: Add index for efficient date-range queries
CREATE INDEX IF NOT EXISTS idx_function_room_bookings_date_end
  ON public.function_room_bookings (booking_date_end);

-- Step 6: Drop and recreate the overlap trigger to handle date ranges
-- Old logic: booking_date = NEW.booking_date (single-day only)
-- New logic: date ranges overlap if NEW.booking_date <= b.booking_date_end
--            AND NEW.booking_date_end >= b.booking_date

DROP TRIGGER IF EXISTS trg_prevent_function_room_booking_overlap
  ON public.function_room_bookings;

CREATE OR REPLACE FUNCTION prevent_function_room_booking_overlap()
RETURNS TRIGGER AS $$
DECLARE
  room_ids_to_check JSONB;
BEGIN
  room_ids_to_check := COALESCE(NEW.function_room_ids, jsonb_build_array(NEW.function_room_id::text));

  -- Date ranges overlap when:
  --   new booking starts before or on the day the existing booking ends
  --   AND new booking ends on or after the day the existing booking starts
  --   AND time slots also overlap within any shared day
  IF EXISTS (
    SELECT 1
    FROM public.function_room_bookings b
    WHERE b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND b.status IN ('CONFIRMED', 'PENDING')
      AND NEW.status IN ('CONFIRMED', 'PENDING')
      -- Date range overlap check
      AND NEW.booking_date <= b.booking_date_end
      AND NEW.booking_date_end >= b.booking_date
      -- Time slot overlap check (applies within any overlapping day)
      AND NEW.start_time < b.end_time
      AND NEW.end_time > b.start_time
      -- Room overlap check (at least one shared room)
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(room_ids_to_check) AS new_room_id
        JOIN jsonb_array_elements_text(
          COALESCE(b.function_room_ids, jsonb_build_array(b.function_room_id::text))
        ) AS existing_room_id ON new_room_id.value = existing_room_id.value
      )
  ) THEN
    RAISE EXCEPTION 'One or more selected function rooms already have a booking that overlaps with the selected date range and time slot.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_function_room_booking_overlap
BEFORE INSERT OR UPDATE OF function_room_id, function_room_ids, booking_date, booking_date_end, start_time, end_time, status
ON public.function_room_bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_function_room_booking_overlap();

-- Step 7: Add comment for documentation
COMMENT ON COLUMN public.function_room_bookings.booking_date_end IS
  'End date of the booking (inclusive). For single-day bookings, equals booking_date. For multi-day events, this is the last day of the booking.';
