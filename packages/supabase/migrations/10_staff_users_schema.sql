-- Staff users table and seed demo account for the staff app login flow.
CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'FRONT_DESK' CHECK (role IN ('FRONT_DESK', 'KITCHEN', 'HOUSEKEEPING', 'SPA', 'MANAGER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_users_hotel_id ON staff_users(hotel_id);
CREATE INDEX IF NOT EXISTS idx_staff_users_email ON staff_users(email);

INSERT INTO staff_users (id, hotel_id, full_name, email, password, role, is_active)
SELECT
  '11111111-1111-4111-8111-111111111111'::uuid,
  h.id,
  'Maria Santos',
  'frontdesk@demo.local',
  'demo123456',
  'FRONT_DESK',
  TRUE
FROM hotels h
WHERE h.name = 'Grand Hotel'
ON CONFLICT (email) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'requests' AND column_name = 'claimed_by' AND data_type = 'text'
  ) THEN
    ALTER TABLE requests ALTER COLUMN claimed_by TYPE UUID USING (CASE WHEN claimed_by = '' THEN NULL ELSE claimed_by::UUID END);
  END IF;
END $$;
