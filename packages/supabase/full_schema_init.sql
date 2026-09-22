-- ============================================================
-- FILE: 00_base_schema.sql
-- ============================================================
-- ============================================================
-- Phase 0: Base Multi-Tenant Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- HOTELS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS hotels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_created_at ON hotels(created_at);

-- ============================================================
-- ROOMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_number   TEXT NOT NULL,
  floor         TEXT,
  room_type     TEXT DEFAULT 'STANDARD',
  qr_auth_hash  TEXT UNIQUE NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_hotel_id ON rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_rooms_qr_auth_hash ON rooms(qr_auth_hash);

-- ============================================================
-- GUEST SESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  phone_number  TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CHECKED_OUT')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_room_id ON guest_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_hotel_id ON guest_sessions(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_status ON guest_sessions(status);

-- ============================================================
-- SEED DATA
-- ============================================================
-- Insert Grand Hotel
INSERT INTO hotels (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Grand Hotel',
  '1 Grand Avenue, Luxury District',
  '+1-800-555-0100'
)
ON CONFLICT (id) DO NOTHING;

-- Insert Room 302
INSERT INTO rooms (id, hotel_id, room_number, floor, room_type, qr_auth_hash)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  '302',
  '3',
  'DELUXE',
  'secret-hash-302'
)
ON CONFLICT (id) DO NOTHING;

-- Insert Room 101 (bonus seed)
INSERT INTO rooms (id, hotel_id, room_number, floor, room_type, qr_auth_hash)
VALUES (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000001',
  '101',
  '1',
  'STANDARD',
  'secret-hash-101'
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- FILE: 01_requests_schema.sql
-- ============================================================
-- ============================================================
-- Phase 1: Requests Schema & Realtime Setup
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Create Requests Table
CREATE TABLE IF NOT EXISTS requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  request_type  TEXT NOT NULL DEFAULT 'CALL_REQUEST',
  status        TEXT NOT NULL DEFAULT 'PENDING',
  payload       JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ,
  claimed_by    UUID
);

-- Drop old CHECK constraint and add expanded one (idempotent: DROP IF EXISTS works in PG 9.4+)
DO $$ BEGIN
  ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
  ALTER TABLE requests ADD CONSTRAINT requests_status_check
    CHECK (status IN (
      'PENDING',
      'PENDING_ON_CALL',
      'CLAIMED',
      'CONFIRMED',
      'DECLINED',
      'PREPARING',
      'RESOLVED',
      'ESCALATED_L1',
      'CANCELLED'
    ));
EXCEPTION WHEN others THEN
  NULL; -- table may not exist yet on first run, CREATE TABLE above handles it
END $$;

-- Indexes for fast queue lookups
CREATE INDEX IF NOT EXISTS idx_requests_hotel_id ON requests(hotel_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_room_id ON requests(room_id);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at DESC);

-- Enable Publication for Realtime (WebSockets) â€” idempotent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE requests;
  END IF;
END $$;

-- Enable Row Level Security (RLS)
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;

-- Allow public anonymous access (guests & staff demo) â€” idempotent
DROP POLICY IF EXISTS "Allow public read access to requests"   ON requests;
DROP POLICY IF EXISTS "Allow public insert access to requests" ON requests;
DROP POLICY IF EXISTS "Allow public update access to requests" ON requests;
CREATE POLICY "Allow public read access to requests"   ON requests FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to requests" ON requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access to requests" ON requests FOR UPDATE USING (true);


-- ============================================================
-- FILE: 02_spa_schema.sql
-- ============================================================
-- ============================================================
-- Phase 2: Spa Booking & Therapist Management Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. CATALOG ITEMS TABLE (Shared for Spa, F&B, Room Requests)
CREATE TABLE IF NOT EXISTS catalog_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  department        TEXT NOT NULL DEFAULT 'SPA' CHECK (department IN ('SPA', 'F_AND_B', 'ROOM_REQUEST')),
  name              TEXT NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  duration_mins     INT DEFAULT 60,
  requires_on_call  BOOLEAN NOT NULL DEFAULT FALSE,
  is_available      BOOLEAN NOT NULL DEFAULT TRUE,
  image_url         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_hotel_dept ON catalog_items(hotel_id, department);
CREATE INDEX IF NOT EXISTS idx_catalog_items_available ON catalog_items(is_available);

-- 2. THERAPISTS TABLE
CREATE TABLE IF NOT EXISTS therapists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  is_on_call  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_therapists_hotel_id ON therapists(hotel_id);

-- 3. SPA SLOT LOCKS TABLE
CREATE TABLE IF NOT EXISTS spa_slot_locks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  therapist_id  UUID REFERENCES therapists(id) ON DELETE SET NULL,
  session_id    UUID REFERENCES guest_sessions(id) ON DELETE CASCADE,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'BOOKED', 'EXPIRED', 'CANCELLED')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spa_slot_locks_hotel ON spa_slot_locks(hotel_id);
CREATE INDEX IF NOT EXISTS idx_spa_slot_locks_status ON spa_slot_locks(status);
CREATE INDEX IF NOT EXISTS idx_spa_slot_locks_time ON spa_slot_locks(start_time, end_time);

-- Enable Publication for Realtime (WebSockets) â€” idempotent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'catalog_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE catalog_items;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'therapists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE therapists;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'spa_slot_locks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE spa_slot_locks;
  END IF;
END $$;

-- Enable Row Level Security (RLS)
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapists ENABLE ROW LEVEL SECURITY;
ALTER TABLE spa_slot_locks ENABLE ROW LEVEL SECURITY;

-- Allow public read & write for demo purposes (idempotent)
DROP POLICY IF EXISTS "Allow public read catalog_items" ON catalog_items;
DROP POLICY IF EXISTS "Allow public all catalog_items"  ON catalog_items;
CREATE POLICY "Allow public read catalog_items" ON catalog_items FOR SELECT USING (true);
CREATE POLICY "Allow public all catalog_items"  ON catalog_items FOR ALL    USING (true);

DROP POLICY IF EXISTS "Allow public read therapists" ON therapists;
DROP POLICY IF EXISTS "Allow public all therapists"  ON therapists;
CREATE POLICY "Allow public read therapists" ON therapists FOR SELECT USING (true);
CREATE POLICY "Allow public all therapists"  ON therapists FOR ALL    USING (true);

DROP POLICY IF EXISTS "Allow public read spa_slot_locks" ON spa_slot_locks;
DROP POLICY IF EXISTS "Allow public all spa_slot_locks"  ON spa_slot_locks;
CREATE POLICY "Allow public read spa_slot_locks" ON spa_slot_locks FOR SELECT USING (true);
CREATE POLICY "Allow public all spa_slot_locks"  ON spa_slot_locks FOR ALL    USING (true);

-- ============================================================
-- SEED DATA FOR SPA & THERAPISTS
-- ============================================================

-- Insert Spa Treatments into catalog_items
INSERT INTO catalog_items (id, hotel_id, department, name, description, price, duration_mins, requires_on_call, is_available, image_url)
VALUES 
(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'SPA',
  'Deep Tissue Massage',
  'Intense muscle therapy using deep pressure to relieve tension and chronic stiffness.',
  120.00,
  60,
  FALSE,
  TRUE,
  'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=500&q=80'
),
(
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'SPA',
  'Aromatherapy Wellness Massage',
  'Gentle soothing massage with essential oils curated for ultimate relaxation and stress relief.',
  140.00,
  75,
  FALSE,
  TRUE,
  'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=500&q=80'
),
(
  '10000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'SPA',
  'Hot Stone Signature Therapy',
  'Warm basalt stones combined with targeted massage techniques to ease muscle soreness.',
  160.00,
  90,
  TRUE,
  TRUE,
  'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=500&q=80'
)
ON CONFLICT (id) DO NOTHING;

-- Insert Therapists
INSERT INTO therapists (id, hotel_id, full_name, is_on_call, is_active)
VALUES
(
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Elena Rostova (In-House Senior)',
  FALSE,
  TRUE
),
(
  '20000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Marcus Vance (On-Call Specialist)',
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- FILE: 03_fnb_schema.sql
-- ============================================================
-- ============================================================
-- Phase 3: Food & Beverage Schema
-- Run this in Supabase SQL Editor AFTER 02_spa_schema.sql
-- ============================================================

-- â”€â”€ 1. Extend catalog_items for F&B columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS category       TEXT,
  ADD COLUMN IF NOT EXISTS dietary_tags   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order     INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_available   BOOLEAN DEFAULT TRUE;

-- â”€â”€ 2. Ensure PREPARING & ESCALATED statuses exist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- (requests.status is TEXT so no enum migration needed)

-- â”€â”€ 3. Seed F&B catalog items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Hotel ID: 00000000-0000-0000-0000-000000000001 (Grand Hotel)

-- Breakfast
INSERT INTO catalog_items (id, hotel_id, department, category, name, description, price, dietary_tags, sort_order, is_available, image_url)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Breakfast', 'Classic Eggs Benedict',
   'Two poached eggs on English muffins with Canadian bacon and hollandaise sauce', 22.00,
   '{}', 1, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Breakfast', 'Avocado Toast',
   'Smashed avocado on sourdough with cherry tomatoes and feta cheese', 18.00,
   ARRAY['VEGETARIAN'], 2, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Breakfast', 'AÃ§aÃ­ Bowl',
   'Blended aÃ§aÃ­ with granola, fresh berries, banana and honey drizzle', 16.00,
   ARRAY['VEGAN', 'GLUTEN_FREE'], 3, true, null),

-- Mains
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Mains', 'Grilled Wagyu Burger',
   'A5 wagyu beef patty, truffle aioli, aged cheddar, brioche bun, hand-cut fries', 38.00,
   '{}', 10, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Mains', 'Pan-Seared Salmon',
   'Atlantic salmon, lemon butter sauce, asparagus, roasted fingerling potatoes', 42.00,
   ARRAY['GLUTEN_FREE'], 11, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Mains', 'Truffle Risotto',
   'Carnaroli rice, black truffle, parmesan crisp, micro herbs', 34.00,
   ARRAY['VEGETARIAN', 'GLUTEN_FREE'], 12, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Mains', 'Lobster Linguine',
   'Boston lobster, cherry tomatoes, garlic white wine sauce, fresh herbs', 58.00,
   '{}', 13, true, null),

-- Starters & Sides
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Starters', 'Burrata & Heirloom Tomatoes',
   'Fresh burrata, heirloom tomatoes, basil oil, sea salt, sourdough crostini', 22.00,
   ARRAY['VEGETARIAN'], 20, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Starters', 'Shrimp Cocktail',
   'Chilled jumbo shrimp, house cocktail sauce, lemon', 28.00,
   ARRAY['GLUTEN_FREE'], 21, true, null),

-- Desserts
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Desserts', 'Warm Chocolate Fondant',
   'Dark chocolate lava cake, vanilla bean ice cream, salted caramel sauce', 18.00,
   ARRAY['VEGETARIAN'], 30, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Desserts', 'CrÃ¨me BrÃ»lÃ©e',
   'Classic vanilla custard, caramelised sugar crust, seasonal berries', 16.00,
   ARRAY['VEGETARIAN', 'GLUTEN_FREE'], 31, true, null),

-- Drinks
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Drinks', 'Fresh Pressed Juices',
   'Choose: Orange, Green Apple & Ginger, or Watermelon Mint', 12.00,
   ARRAY['VEGAN', 'GLUTEN_FREE'], 40, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Drinks', 'Signature Mocktail',
   'House-crafted non-alcoholic cocktail â€” ask for today''s selection', 14.00,
   ARRAY['VEGAN'], 41, true, null),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'F_AND_B', 'Drinks', 'Specialty Coffee',
   'Single-origin espresso, oat milk, choice of hot or iced', 10.00,
   ARRAY['VEGAN'], 42, true, null)
ON CONFLICT (id) DO NOTHING;

-- â”€â”€ 4. Enable Realtime on catalog_items (if not already) â”€â”€â”€â”€â”€â”€
-- (Realtime was already enabled in 02_spa_schema.sql)

-- â”€â”€ 5. RLS: Allow anonymous inserts to requests for food orders â”€
-- (RLS policy already exists from 01_requests_schema.sql)


-- ============================================================
-- FILE: 04_tasks_schema.sql
-- ============================================================
-- ============================================================
-- Phase 4: Room Requests & Task Routing Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Extend catalog_items with task-specific fields (idempotent)
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS priority           TEXT DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  ADD COLUMN IF NOT EXISTS target_sla_mins   INT  DEFAULT 30,
  ADD COLUMN IF NOT EXISTS target_department TEXT
    CHECK (target_department IN ('HOUSEKEEPING', 'MAINTENANCE', 'FRONT_DESK'));

-- 2. SLA Escalations table
CREATE TABLE IF NOT EXISTS sla_escalations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  escalation_level INT  NOT NULL DEFAULT 1,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_escalations_request ON sla_escalations(request_id);
CREATE INDEX IF NOT EXISTS idx_sla_escalations_triggered ON sla_escalations(triggered_at DESC);

-- 3. Realtime for sla_escalations â€” idempotent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sla_escalations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sla_escalations;
  END IF;
END $$;

-- 4. RLS for sla_escalations â€” idempotent
ALTER TABLE sla_escalations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read sla_escalations"   ON sla_escalations;
DROP POLICY IF EXISTS "Allow public insert sla_escalations" ON sla_escalations;
CREATE POLICY "Allow public read sla_escalations"   ON sla_escalations FOR SELECT USING (true);
CREATE POLICY "Allow public insert sla_escalations" ON sla_escalations FOR INSERT WITH CHECK (true);

-- ============================================================
-- SEED DATA: Room Request Catalog Items
-- ============================================================

INSERT INTO catalog_items (
  id, hotel_id, department, name, description,
  price, is_available, requires_on_call,
  priority, target_sla_mins, target_department,
  sort_order, category
) VALUES

-- HOUSEKEEPING (SLA 15 mins)
(
  'A0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Extra Towels', 'Request additional bath or hand towels.',
  0, TRUE, FALSE, 'MEDIUM', 15, 'HOUSEKEEPING', 1, 'Housekeeping'
),
(
  'A0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Pillow Top-Up', 'Request extra pillows for the bed.',
  0, TRUE, FALSE, 'LOW', 20, 'HOUSEKEEPING', 2, 'Housekeeping'
),
(
  'A0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Toiletry Refill', 'Request shampoo, conditioner, soap, or other toiletries.',
  0, TRUE, FALSE, 'LOW', 20, 'HOUSEKEEPING', 3, 'Housekeeping'
),
(
  'A0000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Room Cleaning', 'Request a full room cleaning and bed turndown.',
  0, TRUE, FALSE, 'MEDIUM', 30, 'HOUSEKEEPING', 4, 'Housekeeping'
),
(
  'A0000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Laundry Pickup', 'Schedule laundry pickup from your room.',
  0, TRUE, FALSE, 'LOW', 30, 'HOUSEKEEPING', 5, 'Housekeeping'
),

-- MAINTENANCE (SLA 30 mins)
(
  'A0000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'AC Not Working', 'Air conditioning unit has an issue.',
  0, TRUE, FALSE, 'URGENT', 20, 'MAINTENANCE', 1, 'Maintenance'
),
(
  'A0000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'TV / Remote Issue', 'TV or remote control not functioning.',
  0, TRUE, FALSE, 'MEDIUM', 30, 'MAINTENANCE', 2, 'Maintenance'
),
(
  'A0000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Plumbing Issue', 'Report a leak, clog, or water pressure issue.',
  0, TRUE, FALSE, 'HIGH', 20, 'MAINTENANCE', 3, 'Maintenance'
),
(
  'A0000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Light Bulb Out', 'A light in the room needs replacing.',
  0, TRUE, FALSE, 'LOW', 45, 'MAINTENANCE', 4, 'Maintenance'
),

-- FRONT DESK (SLA 10 mins)
(
  'A0000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Extra Key Card', 'Request an additional or replacement key card.',
  0, TRUE, FALSE, 'HIGH', 10, 'FRONT_DESK', 1, 'Front Desk'
),
(
  'A0000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Late Checkout Request', 'Request an extension to your checkout time.',
  0, TRUE, FALSE, 'MEDIUM', 15, 'FRONT_DESK', 2, 'Front Desk'
),
(
  'A0000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  'ROOM_REQUEST', 'Luggage Assistance', 'Request bellhop help with your luggage.',
  0, TRUE, FALSE, 'MEDIUM', 10, 'FRONT_DESK', 3, 'Front Desk'
)

ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- FILE: 05_analytics_audit_schema.sql
-- ============================================================
-- ============================================================
-- Phase 5: Analytics, SLA Escalations & Audit Logs Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  request_id  UUID REFERENCES requests(id) ON DELETE CASCADE,
  action      TEXT NOT NULL, -- e.g. 'REQUEST_CREATED', 'STATUS_CHANGED', 'SLA_BREACHED', 'ESCALATED_L1'
  actor_id    UUID,
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_hotel ON audit_logs(hotel_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 2. REALTIME & RLS FOR AUDIT LOGS â€” idempotent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
  END IF;
END $$;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read audit_logs"   ON audit_logs;
DROP POLICY IF EXISTS "Allow public insert audit_logs" ON audit_logs;
CREATE POLICY "Allow public read audit_logs"   ON audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert audit_logs" ON audit_logs FOR INSERT WITH CHECK (true);

-- 3. POSTGRES TRIGGER: Automatic Audit Logging for Requests
CREATE OR REPLACE FUNCTION trg_requests_audit_logger()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_logs (hotel_id, request_id, action, details)
    VALUES (
      NEW.hotel_id,
      NEW.id,
      'REQUEST_CREATED',
      jsonb_build_object(
        'request_type', NEW.request_type,
        'initial_status', NEW.status,
        'room_id', NEW.room_id,
        'payload', NEW.payload
      )
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO audit_logs (hotel_id, request_id, action, details)
      VALUES (
        NEW.hotel_id,
        NEW.id,
        CASE
          WHEN NEW.status = 'ESCALATED_L1' THEN 'ESCALATED_L1'
          ELSE 'STATUS_CHANGED'
        END,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'request_type', NEW.request_type,
          'claimed_at', NEW.claimed_at,
          'claimed_by', NEW.claimed_by
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS requests_audit_trigger ON requests;
CREATE TRIGGER requests_audit_trigger
  AFTER INSERT OR UPDATE ON requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_requests_audit_logger();

-- 4. FUNCTION: Check SLA Breaches & Escalate
CREATE OR REPLACE FUNCTION check_sla_breaches(hotel_id_param UUID)
RETURNS INT AS $$
DECLARE
  breached_count INT := 0;
  req RECORD;
BEGIN
  FOR req IN
    SELECT id, hotel_id, request_type, status, created_at
    FROM requests
    WHERE hotel_id = hotel_id_param
      AND status IN ('PENDING', 'PENDING_ON_CALL')
      AND created_at < (NOW() - INTERVAL '20 minutes')
  LOOP
    -- Update status to ESCALATED_L1 (trigger handles audit log entry)
    UPDATE requests
    SET status = 'ESCALATED_L1'
    WHERE id = req.id;

    -- Add explicit SLA breach log entry
    INSERT INTO audit_logs (hotel_id, request_id, action, details)
    VALUES (
      req.hotel_id,
      req.id,
      'SLA_BREACHED',
      jsonb_build_object(
        'request_type', req.request_type,
        'overdue_mins', EXTRACT(EPOCH FROM (NOW() - req.created_at))/60
      )
    );

    breached_count := breached_count + 1;
  END LOOP;

  RETURN breached_count;
END;
$$ LANGUAGE plpgsql;

-- 5. SEED DATA: Sample Audit Logs for ROI Dashboard & Audit Timeline
INSERT INTO audit_logs (hotel_id, request_id, action, details, created_at)
VALUES
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'REQUEST_CREATED',
  '{"request_type": "FOOD_ORDER", "initial_status": "PENDING", "room_number": "302", "item": "Wagyu Beef Burger"}'::jsonb,
  NOW() - INTERVAL '2 hours'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'STATUS_CHANGED',
  '{"old_status": "PENDING", "new_status": "PREPARING", "request_type": "FOOD_ORDER"}'::jsonb,
  NOW() - INTERVAL '1 hour 50 mins'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'STATUS_CHANGED',
  '{"old_status": "PREPARING", "new_status": "RESOLVED", "request_type": "FOOD_ORDER"}'::jsonb,
  NOW() - INTERVAL '1 hour 30 mins'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'REQUEST_CREATED',
  '{"request_type": "SPA_BOOKING", "initial_status": "PENDING", "room_number": "302", "service": "Deep Tissue Massage"}'::jsonb,
  NOW() - INTERVAL '4 hours'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'STATUS_CHANGED',
  '{"old_status": "PENDING", "new_status": "CONFIRMED", "request_type": "SPA_BOOKING"}'::jsonb,
  NOW() - INTERVAL '3 hours 55 mins'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'SLA_BREACHED',
  '{"request_type": "TASK", "target_department": "MAINTENANCE", "overdue_mins": 25}'::jsonb,
  NOW() - INTERVAL '5 hours'
),
(
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'ESCALATED_L1',
  '{"request_type": "TASK", "old_status": "PENDING", "new_status": "ESCALATED_L1", "reason": "SLA timeout exceeded"}'::jsonb,
  NOW() - INTERVAL '5 hours'
);


-- ============================================================
-- FILE: 06_hotel_settings_schema.sql
-- ============================================================
-- ============================================================
-- Phase 6: Hotel Settings & Branding Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. ADD COLOR_SCHEME TO HOTELS TABLE
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS color_scheme TEXT DEFAULT 'gold';

-- 2. UPDATE DEFAULT SEED DATA FOR GRAND HOTEL
UPDATE hotels
SET 
  phone = COALESCE(phone, '+1-800-555-0100'),
  logo_url = COALESCE(logo_url, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=120'),
  color_scheme = COALESCE(color_scheme, 'gold')
WHERE id = '00000000-0000-0000-0000-000000000001';


-- ============================================================
-- FILE: 07_menu_catalog_schema.sql
-- ============================================================
-- â”€â”€ 07_menu_catalog_schema.sql â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Dedicated Menu Catalog table for F&B/Dining ordering & staff management

CREATE TABLE IF NOT EXISTS menu_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  category TEXT NOT NULL,
  is_available BOOLEAN DEFAULT true,
  image_url TEXT,
  dietary_tags TEXT[] DEFAULT '{}',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performant lookup & filtering
CREATE INDEX IF NOT EXISTS idx_menu_catalog_hotel ON menu_catalog(hotel_id, category);
CREATE INDEX IF NOT EXISTS idx_menu_catalog_available ON menu_catalog(is_available);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'menu_catalog'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE menu_catalog;
  END IF;
END $$;

-- Enable Row Level Security (RLS)
ALTER TABLE menu_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read menu_catalog" ON menu_catalog;
DROP POLICY IF EXISTS "Allow public all menu_catalog" ON menu_catalog;

CREATE POLICY "Allow public read menu_catalog" ON menu_catalog FOR SELECT USING (true);
CREATE POLICY "Allow public all menu_catalog" ON menu_catalog FOR ALL USING (true);

-- Seed initial menu catalog data for Hotel 00000000-0000-0000-0000-000000000001
INSERT INTO menu_catalog (id, hotel_id, category, name, description, price, dietary_tags, sort_order, is_available)
VALUES
  -- Breakfast
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Breakfast', 'Classic Eggs Benedict', 'Two poached eggs on English muffins with Canadian bacon and hollandaise sauce', 22.00, '{}', 1, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Breakfast', 'Avocado Toast', 'Smashed avocado on sourdough with cherry tomatoes and feta cheese', 18.00, ARRAY['VEGETARIAN'], 2, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Breakfast', 'AÃ§aÃ­ Bowl', 'Blended aÃ§aÃ­ with granola, fresh berries, banana and honey drizzle', 16.00, ARRAY['VEGAN', 'GLUTEN_FREE'], 3, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Breakfast', 'Brioche French Toast', 'Thick brioche slices, maple syrup, berry compote, whipped butter', 20.00, ARRAY['VEGETARIAN'], 4, true),

  -- Mains
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Mains', 'Grilled Wagyu Burger', 'A5 wagyu beef patty, truffle aioli, aged cheddar, brioche bun, hand-cut fries', 38.00, '{}', 10, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Mains', 'Pan-Seared Salmon', 'Atlantic salmon, lemon butter sauce, asparagus, roasted fingerling potatoes', 42.00, ARRAY['GLUTEN_FREE'], 11, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Mains', 'Truffle Risotto', 'Carnaroli rice, black truffle, parmesan crisp, micro herbs', 34.00, ARRAY['VEGETARIAN', 'GLUTEN_FREE'], 12, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Mains', 'Lobster Linguine', 'Boston lobster, cherry tomatoes, garlic white wine sauce, fresh herbs', 58.00, '{}', 13, true),

  -- Starters
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Starters', 'Burrata & Heirloom Tomatoes', 'Fresh burrata, heirloom tomatoes, basil oil, sea salt, sourdough crostini', 22.00, ARRAY['VEGETARIAN'], 20, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Starters', 'Shrimp Cocktail', 'Chilled jumbo shrimp, house cocktail sauce, lemon', 28.00, ARRAY['GLUTEN_FREE'], 21, true),

  -- Desserts
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Desserts', 'Tiramisu', 'Classic Italian tiramisu with espresso-soaked ladyfingers and mascarpone', 14.00, ARRAY['VEGETARIAN'], 30, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Desserts', 'Chocolate Lava Cake', 'Warm chocolate cake with molten center, served with vanilla bean ice cream', 16.00, ARRAY['VEGETARIAN'], 31, true),

  -- Beverages
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Beverages', 'Fresh Orange Juice', '100% freshly squeezed orange juice', 8.00, ARRAY['VEGAN', 'GLUTEN_FREE'], 40, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Beverages', 'Iced Vanilla Latte', 'Double espresso shot, oat milk, artisanal vanilla syrup', 7.00, ARRAY['VEGAN'], 41, true)
ON CONFLICT DO NOTHING;


-- ============================================================
-- FILE: 08_spa_time_slots_schema.sql
-- ============================================================
-- ============================================================
-- Phase 6: Spa Time Slots Management Schema
-- Hotel QR Ordering System
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS spa_time_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  slot_time     TEXT NOT NULL,
  is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  is_on_call    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spa_time_slots_hotel ON spa_time_slots(hotel_id);
CREATE INDEX IF NOT EXISTS idx_spa_time_slots_available ON spa_time_slots(is_available);

-- Enable RLS
ALTER TABLE spa_time_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read spa_time_slots" ON spa_time_slots;
DROP POLICY IF EXISTS "Allow public all spa_time_slots"  ON spa_time_slots;
CREATE POLICY "Allow public read spa_time_slots" ON spa_time_slots FOR SELECT USING (true);
CREATE POLICY "Allow public all spa_time_slots"  ON spa_time_slots FOR ALL    USING (true);

-- Seed initial time slots
INSERT INTO spa_time_slots (id, hotel_id, slot_time, is_available, is_on_call)
VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10:00 AM', true, false),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '11:30 AM', true, false),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '01:00 PM', true, false),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '02:30 PM', true, false),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '04:00 PM', true, false),
  ('30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '05:30 PM', true, true)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- FILE: 09_seed_default_room.sql
-- ============================================================
-- Ensure DEFAULT_ROOM_ID exists in rooms (safe seed)

INSERT INTO rooms (id, hotel_id, room_number, floor, room_type, qr_auth_hash, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  '302',
  '3',
  'DELUXE',
  'seed-default-302',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Optional: record audit log (if audit_logs table exists)
INSERT INTO audit_logs (hotel_id, action, details)
SELECT '00000000-0000-0000-0000-000000000001', 'SEED_ROOM_APPLIED', json_build_object('room_id', '00000000-0000-0000-0000-000000000101')
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE id = '00000000-0000-0000-0000-000000000101');


-- ============================================================
-- FILE: 10_staff_users_schema.sql
-- ============================================================
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


-- ============================================================
-- FILE: 11_scheduled_booking_expiration.sql
-- ============================================================
-- Use the scheduled appointment window when evaluating pending bookings.
-- This migration is additive and preserves created_at behavior for legacy rows.

CREATE OR REPLACE FUNCTION check_sla_breaches(hotel_id_param UUID)
RETURNS INT AS $$
DECLARE
  breached_count INT := 0;
  req RECORD;
  scheduled_end TIMESTAMPTZ;
BEGIN
  FOR req IN
    SELECT id, hotel_id, request_type, status, created_at, payload
    FROM requests
    WHERE hotel_id = hotel_id_param
      AND status IN ('PENDING', 'PENDING_ON_CALL')
  LOOP
    scheduled_end := CASE
      WHEN req.payload->>'scheduled_at' IS NOT NULL
        AND req.payload->>'scheduled_at' <> ''
      THEN (req.payload->>'scheduled_at')::timestamptz
        + (CASE
            WHEN req.payload->>'duration_mins' ~ '^[0-9]+$'
            THEN (req.payload->>'duration_mins')::int
            ELSE 60
          END * INTERVAL '1 minute')
      ELSE req.created_at + INTERVAL '20 minutes'
    END;

    IF scheduled_end >= NOW() THEN
      CONTINUE;
    END IF;

    UPDATE requests
    SET status = 'ESCALATED_L1'
    WHERE id = req.id;

    INSERT INTO audit_logs (hotel_id, request_id, action, details)
    VALUES (
      req.hotel_id,
      req.id,
      'SLA_BREACHED',
      jsonb_build_object(
        'request_type', req.request_type,
        'scheduled_end', scheduled_end,
        'overdue_mins', EXTRACT(EPOCH FROM (NOW() - scheduled_end))/60
      )
    );

    breached_count := breached_count + 1;
  END LOOP;

  RETURN breached_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FILE: 12_spa_reservation_hardening.sql
-- ============================================================
-- ============================================================
-- Phase 2: SPA Reservation Integrity Hardening
-- Hotel QR Ordering System
-- IMPORTANT: This is a repository change intended for review before
-- applying to the live Supabase project. Do not run this migration in
-- production until the team approves the rollout.
-- ============================================================

ALTER TABLE spa_slot_locks
  ADD COLUMN IF NOT EXISTS request_id UUID NULL REFERENCES requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spa_slot_locks_request_id
  ON spa_slot_locks(request_id);

CREATE INDEX IF NOT EXISTS idx_spa_slot_locks_hotel_therapist_status_time
  ON spa_slot_locks(hotel_id, therapist_id, status, start_time, end_time);

CREATE OR REPLACE FUNCTION create_spa_reservation(
  p_hotel_id UUID,
  p_room_id UUID,
  p_session_id UUID,
  p_therapist_id UUID,
  p_request_status TEXT,
  p_payload JSONB,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (request_id UUID, lock_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_request_id UUID;
  v_lock_id UUID;
  v_effective_expires_at TIMESTAMPTZ;
BEGIN
  IF p_therapist_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM spa_slot_locks
      WHERE hotel_id = p_hotel_id
        AND therapist_id = p_therapist_id
        AND status IN ('HELD', 'BOOKED')
        AND p_start_time < end_time
        AND p_end_time > start_time
    ) THEN
      RAISE EXCEPTION 'Spa therapist has an overlapping active reservation for the selected time window';
    END IF;
  END IF;

  v_effective_expires_at := COALESCE(p_expires_at, p_end_time + INTERVAL '10 minutes');

  INSERT INTO requests (hotel_id, room_id, request_type, status, payload)
  VALUES (p_hotel_id, p_room_id, 'SPA_BOOKING', p_request_status, p_payload)
  RETURNING id INTO v_request_id;

  INSERT INTO spa_slot_locks (
    hotel_id,
    therapist_id,
    session_id,
    start_time,
    end_time,
    status,
    expires_at,
    request_id
  )
  VALUES (
    p_hotel_id,
    p_therapist_id,
    p_session_id,
    p_start_time,
    p_end_time,
    'BOOKED',
    v_effective_expires_at,
    v_request_id
  )
  RETURNING id INTO v_lock_id;

  RETURN QUERY
  SELECT v_request_id, v_lock_id;
END;
$$;

CREATE OR REPLACE FUNCTION expire_spa_holds()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count INT := 0;
BEGIN
  WITH updated AS (
    UPDATE spa_slot_locks
    SET status = 'EXPIRED',
        expires_at = NOW()
    WHERE status = 'HELD'
      AND expires_at <= NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO expired_count FROM updated;

  RETURN expired_count;
END;
$$;

-- Note:
-- This migration creates the stronger data model needed for Phase 2, but the
-- live Supabase project should still be reviewed and applied separately.


-- ============================================================
-- FILE: 13_menu_categories_and_storage.sql
-- ============================================================
-- ============================================================
-- Phase 3+: Dedicated Menu Categories & Storage Support
-- Migration: 13_menu_categories_and_storage.sql
-- ============================================================

-- â”€â”€ 1. Create menu_categories table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'ðŸ½ï¸',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_menu_categories_hotel_name UNIQUE(hotel_id, name)
);

-- Index for performant lookup & sort
CREATE INDEX IF NOT EXISTS idx_menu_categories_hotel_sort ON menu_categories(hotel_id, sort_order, name);

-- â”€â”€ 2. Enable Realtime on menu_categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'menu_categories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE menu_categories;
  END IF;
END $$;

-- â”€â”€ 3. Enable RLS on menu_categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "Allow public all menu_categories" ON menu_categories;

CREATE POLICY "Allow public read menu_categories" ON menu_categories FOR SELECT USING (true);
CREATE POLICY "Allow public all menu_categories" ON menu_categories FOR ALL USING (true);

-- â”€â”€ 4. Seed Default Menu Categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Hotel ID: 00000000-0000-0000-0000-000000000001 (Grand Hotel)
INSERT INTO menu_categories (id, hotel_id, name, icon, sort_order, is_active)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Breakfast', 'ðŸ³', 1, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Starters', 'ðŸ¥—', 2, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Mains', 'ðŸ¥©', 3, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Desserts', 'ðŸ°', 4, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Drinks', 'ðŸ¹', 5, true),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Other', 'ðŸ½ï¸', 99, true)
ON CONFLICT (hotel_id, name) DO NOTHING;

-- â”€â”€ 5. Ensure catalog_items and menu_catalog have image_url â”€â”€
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS image_url TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'menu_catalog') THEN
    ALTER TABLE menu_catalog ADD COLUMN IF NOT EXISTS image_url TEXT;
  END IF;
END $$;


-- ============================================================
-- FILE: 16_cleanup_expired_spa_holds.sql
-- ============================================================
-- ============================================================
-- Migration 16: Automatic Cleanup Cron for Expired HELD Spa Locks
-- Hotel QR Ordering System
--
-- This migration adds:
-- 1. `cleanup_expired_spa_holds()` function:
--    - Marks unconfirmed 'HELD' locks as 'EXPIRED' once expires_at passes
--    - Purges abandoned 'HELD' / 'EXPIRED' lock records older than 1 hour
-- 2. Lazy cleanup trigger on `spa_slot_locks` table on new inserts
-- 3. Optional `pg_cron` recurring schedule (every 10 minutes) if pg_cron is enabled
-- ============================================================

-- 1. Create or Replace the Comprehensive Cleanup Function
CREATE OR REPLACE FUNCTION cleanup_expired_spa_holds()
RETURNS TABLE (
  expired_count INT,
  purged_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired INT := 0;
  v_purged INT := 0;
BEGIN
  -- A. Mark any active HELD locks as EXPIRED if expires_at has passed
  WITH updated AS (
    UPDATE spa_slot_locks
    SET status = 'EXPIRED',
        expires_at = NOW()
    WHERE status = 'HELD'
      AND expires_at <= NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_expired FROM updated;

  -- B. Purge abandoned temporary HELD / EXPIRED locks older than 1 hour
  WITH deleted AS (
    DELETE FROM spa_slot_locks
    WHERE status IN ('HELD', 'EXPIRED')
      AND expires_at < (NOW() - INTERVAL '1 hour')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_purged FROM deleted;

  RETURN QUERY SELECT v_expired, v_purged;
END;
$$;

-- Grant execution to authenticated & service roles
GRANT EXECUTE ON FUNCTION cleanup_expired_spa_holds() TO postgres, authenticated, service_role, anon;

-- 2. Trigger: Automatically sweep expired holds on every new lock attempt (Lazy Self-Cleaning)
CREATE OR REPLACE FUNCTION trigger_cleanup_expired_holds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Perform quick non-blocking sweep of expired holds
  PERFORM cleanup_expired_spa_holds();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_expired_spa_holds ON spa_slot_locks;

CREATE TRIGGER trg_cleanup_expired_spa_holds
  BEFORE INSERT ON spa_slot_locks
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_cleanup_expired_holds();

-- 3. Optional pg_cron recurring job (runs every 10 minutes if pg_cron is available)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Unschedule existing job if already present to prevent duplicate registrations
    BEGIN
      PERFORM cron.unschedule('cleanup-expired-spa-holds');
    EXCEPTION WHEN OTHERS THEN
      -- Ignore if not yet scheduled
    END;

    -- Schedule to run every 10 minutes
    PERFORM cron.schedule(
      'cleanup-expired-spa-holds',
      '*/10 * * * *',
      'SELECT cleanup_expired_spa_holds();'
    );
    RAISE NOTICE 'pg_cron job cleanup-expired-spa-holds registered successfully.';
  ELSE
    RAISE NOTICE 'pg_cron extension not active. Automated trigger on insert will handle cleanup.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pg_cron setup (pg_cron may not be enabled). Insert trigger remains active.';
END $$;


-- ============================================================
-- FILE: 17_web_push_subscriptions.sql
-- ============================================================
-- ============================================================
-- Migration 17: Web Push Subscriptions for Staff PWA Alerts
-- Hotel QR Ordering System
--
-- Stores browser Web Push endpoints (FCM / APNs) registered
-- by staff devices running the Staff App PWA.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lightning fast lookups during request dispatch
CREATE INDEX IF NOT EXISTS idx_staff_push_sub_hotel_active
  ON staff_push_subscriptions(hotel_id, is_active);

CREATE INDEX IF NOT EXISTS idx_staff_push_sub_staff_user
  ON staff_push_subscriptions(staff_user_id);

-- Enable RLS
ALTER TABLE staff_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow public / staff to insert or update their own push subscriptions
DROP POLICY IF EXISTS "Allow staff to manage their push subscriptions" ON staff_push_subscriptions;
CREATE POLICY "Allow staff to manage their push subscriptions"
  ON staff_push_subscriptions
  FOR ALL
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- FILE: 18_add_staff_users_push_token.sql
-- ============================================================
-- Add push_token column to staff_users to store native Android FCM / Expo push tokens
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_staff_users_push_token ON staff_users(push_token);


-- ============================================================
-- FILE: 19_fnb_phone_number.sql
-- ============================================================
-- Migration 19: Add F&B Direct Phone Number to hotels table
-- Supports dynamic dial configuration for F&B staff and guest dining FAB

ALTER TABLE hotels
ADD COLUMN IF NOT EXISTS fnb_phone_number TEXT DEFAULT '+1-800-555-0199';

COMMENT ON COLUMN hotels.fnb_phone_number IS 'Direct phone number for F&B / Room Service dining department';


-- ============================================================
-- FILE: 20_notification_settings.sql
-- ============================================================
-- Migration 20: Notification Settings & Push Token Lifecycle Uniqueness

-- 0. Clean existing duplicate push tokens across staff accounts before applying unique index
-- Keeps the token on the single most recently active staff user and clears duplicate tokens to NULL
WITH ranked_tokens AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY push_token 
           ORDER BY created_at DESC, id DESC
         ) as rnk
  FROM staff_users
  WHERE push_token IS NOT NULL
)
UPDATE staff_users
SET push_token = NULL
WHERE id IN (
  SELECT id FROM ranked_tokens WHERE rnk > 1
);

-- 1. Push Token Uniqueness on staff_users (allowing multiple NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_push_token_unique
ON staff_users(push_token)
WHERE push_token IS NOT NULL;

-- 2. Notification Settings Table
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,
  reminder_interval_minutes INT NOT NULL DEFAULT 5,
  enable_sound_alert BOOLEAN NOT NULL DEFAULT true,
  max_alert_duration_seconds INT NOT NULL DEFAULT 30,
  fnb_allowed_types TEXT[] NOT NULL DEFAULT ARRAY['FOOD_ORDER'],
  frontdesk_allowed_types TEXT[] NOT NULL DEFAULT ARRAY['CALL_REQUEST', 'TASK'],
  spa_allowed_types TEXT[] NOT NULL DEFAULT ARRAY['SPA_BOOKING'],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notification_settings IS 'Global and role-based notification preferences per hotel';

-- 3. Default Seed for Default Hotel
INSERT INTO notification_settings (
  hotel_id,
  reminder_interval_minutes,
  enable_sound_alert,
  max_alert_duration_seconds,
  fnb_allowed_types,
  frontdesk_allowed_types,
  spa_allowed_types
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  5,
  true,
  30,
  ARRAY['FOOD_ORDER'],
  ARRAY['CALL_REQUEST', 'TASK'],
  ARRAY['SPA_BOOKING']
)
ON CONFLICT (hotel_id) DO NOTHING;

-- 4. Row Level Security
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- Allow public / staff read
CREATE POLICY "Allow read notification_settings"
ON notification_settings
FOR SELECT
USING (true);

-- Allow authenticated updates
CREATE POLICY "Allow update notification_settings"
ON notification_settings
FOR ALL
USING (true)
WITH CHECK (true);


-- ============================================================
-- FILE: 21_live_call_channel.sql
-- ============================================================
-- Migration 21: Add agora_channel to requests for live voice calls
-- Stores the Agora RTC channel name for LIVE_CALL request types
-- so both guest and staff can join the same Agora channel.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS agora_channel TEXT;

COMMENT ON COLUMN public.requests.agora_channel IS
  'Agora RTC channel name for LIVE_CALL requests. NULL for all other request types.';


-- ============================================================
-- FILE: 22_function_room_booking.sql
-- ============================================================
-- ============================================================
-- Function Room Booking & Equipment Management Schema
-- Hotel QR Ordering System
-- ============================================================

-- 1. Function rooms table
CREATE TABLE IF NOT EXISTS function_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_function_rooms_hotel_id ON function_rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_function_rooms_active ON function_rooms(is_active);

-- 2. Rental equipment catalog
CREATE TABLE IF NOT EXISTS function_room_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rental_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_function_room_equipments_hotel_id ON function_room_equipments(hotel_id);
CREATE INDEX IF NOT EXISTS idx_function_room_equipments_active ON function_room_equipments(is_active);

-- 3. Booking table
CREATE TABLE IF NOT EXISTS function_room_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  function_room_id UUID NOT NULL REFERENCES function_rooms(id) ON DELETE CASCADE,
  function_room_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  room_names TEXT NOT NULL DEFAULT '',
  booker_name TEXT NOT NULL,
  phone_number TEXT,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  food_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  banquet_food_notes TEXT,
  rented_equipments JSONB NOT NULL DEFAULT '[]'::jsonb,
  downpayment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('CONFIRMED', 'PENDING', 'CANCELLED', 'COMPLETED')),
  created_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

ALTER TABLE function_room_bookings
  ADD COLUMN IF NOT EXISTS function_room_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS room_names TEXT NOT NULL DEFAULT '';

UPDATE function_room_bookings
SET function_room_ids = CASE
  WHEN function_room_ids IS NULL OR function_room_ids = '[]'::jsonb THEN jsonb_build_array(function_room_id::text)
  ELSE function_room_ids
END,
    room_names = CASE
      WHEN room_names IS NULL OR room_names = '' THEN (
        SELECT string_agg(fr.name, ', ' ORDER BY fr.name)
        FROM function_rooms fr
        WHERE fr.id = function_room_bookings.function_room_id
      )
      ELSE room_names
    END
WHERE function_room_ids IS NULL OR function_room_ids = '[]'::jsonb OR room_names IS NULL OR room_names = '';

CREATE INDEX IF NOT EXISTS idx_function_room_bookings_hotel_id ON function_room_bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_function_room_bookings_room_id ON function_room_bookings(function_room_id);
CREATE INDEX IF NOT EXISTS idx_function_room_bookings_date ON function_room_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_function_room_bookings_status ON function_room_bookings(status);

-- 4. Add reminder settings to existing notification settings table
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS notify_same_day BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_days_before INTEGER NOT NULL DEFAULT 1;

UPDATE notification_settings
SET notify_same_day = COALESCE(notify_same_day, true),
    notify_days_before = COALESCE(notify_days_before, 1)
WHERE notify_same_day IS NULL OR notify_days_before IS NULL;

-- 5. Seed default function room data for Grand Hotel
INSERT INTO function_rooms (id, hotel_id, name, capacity, is_active)
VALUES
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001', 'Grand Ballroom', 220, true),
  ('11111111-1111-4111-8111-111111111112', '00000000-0000-0000-0000-000000000001', 'Executive Hall', 120, true),
  ('11111111-1111-4111-8111-111111111113', '00000000-0000-0000-0000-000000000001', 'Garden Terrace', 80, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO function_room_equipments (id, hotel_id, name, rental_price, is_active)
VALUES
  ('22222222-2222-4222-8222-222222222221', '00000000-0000-0000-0000-000000000001', 'Projector & Screen', 1800.00, true),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000001', 'Wireless Mic', 650.00, true),
  ('22222222-2222-4222-8222-222222222223', '00000000-0000-0000-0000-000000000001', 'PA System', 900.00, true),
  ('22222222-2222-4222-8222-222222222224', '00000000-0000-0000-0000-000000000001', 'Stage Lighting Package', 1200.00, true)
ON CONFLICT (id) DO NOTHING;

-- 6. Prevent double-booking same room at overlapping times
CREATE OR REPLACE FUNCTION prevent_function_room_booking_overlap()
RETURNS TRIGGER AS $$
DECLARE
  room_ids_to_check JSONB;
BEGIN
  room_ids_to_check := COALESCE(NEW.function_room_ids, jsonb_build_array(NEW.function_room_id::text));

  IF EXISTS (
    SELECT 1
    FROM function_room_bookings b
    WHERE b.booking_date = NEW.booking_date
      AND b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND b.status IN ('CONFIRMED', 'PENDING')
      AND NEW.status IN ('CONFIRMED', 'PENDING')
      AND NEW.start_time < b.end_time
      AND NEW.end_time > b.start_time
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(room_ids_to_check) AS new_room_id
        WHERE new_room_id.value::uuid = b.function_room_id
      )
  ) THEN
    RAISE EXCEPTION 'One or more selected function rooms already have a booking scheduled during the selected time slot.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_function_room_booking_overlap ON function_room_bookings;
CREATE TRIGGER trg_prevent_function_room_booking_overlap
BEFORE INSERT OR UPDATE OF function_room_id, booking_date, start_time, end_time, status
ON function_room_bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_function_room_booking_overlap();

-- 7. RLS
ALTER TABLE function_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_room_equipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_room_bookings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_rooms'
      AND policyname = 'Allow read function_rooms'
  ) THEN
    CREATE POLICY "Allow read function_rooms"
    ON function_rooms
    FOR SELECT
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_rooms'
      AND policyname = 'Allow write function_rooms'
  ) THEN
    CREATE POLICY "Allow write function_rooms"
    ON function_rooms
    FOR ALL
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_room_equipments'
      AND policyname = 'Allow read function_room_equipments'
  ) THEN
    CREATE POLICY "Allow read function_room_equipments"
    ON function_room_equipments
    FOR SELECT
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_room_equipments'
      AND policyname = 'Allow write function_room_equipments'
  ) THEN
    CREATE POLICY "Allow write function_room_equipments"
    ON function_room_equipments
    FOR ALL
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_room_bookings'
      AND policyname = 'Allow read function_room_bookings'
  ) THEN
    CREATE POLICY "Allow read function_room_bookings"
    ON function_room_bookings
    FOR SELECT
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'function_room_bookings'
      AND policyname = 'Allow write function_room_bookings'
  ) THEN
    CREATE POLICY "Allow write function_room_bookings"
    ON function_room_bookings
    FOR ALL
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- FILE: 23_guest_live_call_toggle.sql
-- ============================================================
-- Migration 23: Guest Live Voice Call Visibility Toggle
-- Adds an admin-controlled boolean to notification_settings that shows/hides
-- the "Live Voice Call" (Agora RTC) button in the guest web Call Front Desk modal.

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS enable_guest_live_call BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN notification_settings.enable_guest_live_call IS 'When FALSE, the Live Voice Call button is hidden on the guest web portal';

-- Backfill existing rows to the default (visible)
UPDATE notification_settings
SET enable_guest_live_call = COALESCE(enable_guest_live_call, TRUE)
WHERE enable_guest_live_call IS NULL;


-- ============================================================
-- FILE: 24_guest_web_theme_content_cms.sql
-- ============================================================
-- ============================================================
-- Migration 24: Guest Web Dynamic Theme & Content CMS
-- Adds visual theme mode + custom colors + editable copy to
-- the hotels table so admins can restyle and rewrite the
-- guest web experience without code deploys.
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. THEME MODE (preset id; 'CUSTOM' uses theme_config colors)
ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS theme_mode TEXT NOT NULL DEFAULT 'DARK_GOLD';

-- 2. CUSTOM / PRESET SURFACE COLORS (JSONB hex palette)
ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS theme_config JSONB;

-- 3. GUEST-FACING COPY (JSONB, sectioned key-value dictionary)
ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS content_config JSONB;

-- ============================================================
-- FILE: 25_live_call_queue_enhancements.sql
-- ============================================================
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


-- ============================================================
-- FILE: 26_function_room_date_range.sql
-- ============================================================
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


-- ============================================================
-- FILE: 27_guest_staff_hybrid_ai_chat.sql
-- ============================================================
-- ============================================================
-- Migration 27: Real-Time Guest & Staff Chat with Hybrid AI Assistant
-- Tables: guest_conversations, guest_chat_messages
-- ============================================================

-- 1. Create guest_conversations table
CREATE TABLE IF NOT EXISTS public.guest_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'BOT_ACTIVE' CHECK (status IN ('BOT_ACTIVE', 'STAFF_HANDOFF', 'RESOLVED')),
  assigned_staff_id UUID REFERENCES public.staff_users(id) ON DELETE SET NULL,
  guest_name TEXT,
  unread_guest_count INTEGER NOT NULL DEFAULT 0,
  unread_staff_count INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_sender TEXT CHECK (last_message_sender IS NULL OR last_message_sender IN ('GUEST', 'AI', 'STAFF', 'SYSTEM')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: 1 active conversation per room (can be resolved and re-opened or newly linked)
CREATE INDEX IF NOT EXISTS idx_guest_conversations_hotel_id ON public.guest_conversations(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_room_id ON public.guest_conversations(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_status ON public.guest_conversations(status);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_last_msg_at ON public.guest_conversations(last_message_at DESC);

-- 2. Create guest_chat_messages table
CREATE TABLE IF NOT EXISTS public.guest_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.guest_conversations(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('GUEST', 'AI', 'STAFF', 'SYSTEM')),
  sender_staff_id UUID REFERENCES public.staff_users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL DEFAULT 'Guest',
  message_text TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_conv_id ON public.guest_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_hotel_id ON public.guest_chat_messages(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_room_id ON public.guest_chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_created_at ON public.guest_chat_messages(created_at ASC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.guest_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_conversations' AND policyname = 'Allow read guest_conversations'
  ) THEN
    CREATE POLICY "Allow read guest_conversations" ON public.guest_conversations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_conversations' AND policyname = 'Allow write guest_conversations'
  ) THEN
    CREATE POLICY "Allow write guest_conversations" ON public.guest_conversations FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_chat_messages' AND policyname = 'Allow read guest_chat_messages'
  ) THEN
    CREATE POLICY "Allow read guest_chat_messages" ON public.guest_chat_messages FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_chat_messages' AND policyname = 'Allow write guest_chat_messages'
  ) THEN
    CREATE POLICY "Allow write guest_chat_messages" ON public.guest_chat_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. Enable Supabase Realtime for both tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_chat_messages;
  END IF;
END $$;


-- ============================================================
-- FILE: 28_add_guest_phone_session_id.sql
-- ============================================================
-- ============================================================
-- Migration 28: Add guest_phone and session_id to guest_conversations
-- Required for: guest session isolation + staff direct call feature
-- Run this in Supabase SQL Editor if not already applied.
-- ============================================================

-- Add session_id column (unique per guest QR scan session)
ALTER TABLE public.guest_conversations
  ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add guest_phone column (captured from phone prompt in guest web)
ALTER TABLE public.guest_conversations
  ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- Index for fast session lookups
CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id
  ON public.guest_conversations(session_id);

-- Index for phone lookups (optional but useful)
CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone
  ON public.guest_conversations(guest_phone);


-- ============================================================
-- FILE: 28_guest_chat_session_and_phone.sql
-- ============================================================
-- ============================================================
-- Migration 28: Guest Chat Session Isolation & Phone Number
-- Adds session_id and guest_phone to guest_conversations
-- ============================================================

-- 1. Add session_id referencing guest_sessions table
ALTER TABLE public.guest_conversations 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL;

-- 2. Add guest_phone for callback reachability
ALTER TABLE public.guest_conversations 
ADD COLUMN IF NOT EXISTS guest_phone TEXT;

-- 3. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_guest_conversations_session_id ON public.guest_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_guest_phone ON public.guest_conversations(guest_phone);

-- 4. Comments for schema documentation
COMMENT ON COLUMN public.guest_conversations.session_id IS 'Unique guest session ID to isolate chat history per guest check-in / scan';
COMMENT ON COLUMN public.guest_conversations.guest_phone IS 'Guest contact phone number for callbacks if chat is disconnected or escalated';


-- ============================================================
-- FILE: 29_push_suppression_and_prefs.sql
-- ============================================================
-- ============================================================
-- Migration 29: Smart Push Suppression & Notification Settings
-- ============================================================
-- Creates:
--   1. staff_presence table           (presence-based push suppression)
--   2. notification_settings columns  (hotel-level push behaviour)
--   3. staff_users columns            (per-staff notification preferences)
--   4. guest_conversations column     (push cooldown tracking)
-- ============================================================

-- â”€â”€ 1. staff_presence table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS public.staff_presence (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id             UUID NOT NULL UNIQUE REFERENCES public.staff_users(id) ON DELETE CASCADE,
  hotel_id                  UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  -- Whether this staff member is currently focused in a chat conversation
  is_active_in_conversation BOOLEAN NOT NULL DEFAULT false,

  -- Which conversation they are viewing (null when not active)
  active_conversation_id    UUID REFERENCES public.guest_conversations(id) ON DELETE SET NULL,

  -- Timestamps: last_seen_at drives the 90-second staleness guard
  last_seen_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.staff_presence IS
  'Tracks which staff member is currently viewing a guest conversation. Used to suppress redundant FCM push notifications when staff are already actively engaged.';

-- Index: fast lookup by conversation_id filtered to active-only rows
CREATE INDEX IF NOT EXISTS idx_staff_presence_conversation
  ON public.staff_presence (active_conversation_id)
  WHERE is_active_in_conversation = true;

-- â”€â”€ RLS for staff_presence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE public.staff_presence ENABLE ROW LEVEL SECURITY;

-- Allow full access for service role (used by webPush.ts server-side queries)
CREATE POLICY "Service role full access to staff_presence"
  ON public.staff_presence
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- â”€â”€ 2. notification_settings â€” hotel-level push behaviour â”€â”€â”€â”€
ALTER TABLE public.notification_settings
  -- Suppress FCM for a staff member who is actively viewing that conversation
  ADD COLUMN IF NOT EXISTS suppress_if_active       BOOLEAN NOT NULL DEFAULT true,

  -- Minimum gap (in seconds) between FCM dispatches for the same conversation.
  -- CHAT_HANDOFF (escalation) always bypasses this.
  ADD COLUMN IF NOT EXISTS push_cooldown_seconds    INT     NOT NULL DEFAULT 30,

  -- Optional hotel-wide quiet hours window (Manila time, 0-23 hour)
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_from         INT     NOT NULL DEFAULT 22,  -- 10 PM
  ADD COLUMN IF NOT EXISTS quiet_hours_to           INT     NOT NULL DEFAULT 7;   -- 7 AM

COMMENT ON COLUMN public.notification_settings.suppress_if_active     IS 'When true, FCM is suppressed for a staff member who is already viewing the conversation';
COMMENT ON COLUMN public.notification_settings.push_cooldown_seconds   IS 'Minimum seconds between GUEST_CHAT pushes per conversation (0 = no cooldown). CHAT_HANDOFF bypasses this.';
COMMENT ON COLUMN public.notification_settings.quiet_hours_enabled     IS 'Enable hotel-wide quiet hours â€” no FCM dispatched during the quiet window';
COMMENT ON COLUMN public.notification_settings.quiet_hours_from        IS 'Start of quiet window (hour, 0-23, Manila/Asia timezone)';
COMMENT ON COLUMN public.notification_settings.quiet_hours_to          IS 'End of quiet window (hour, 0-23, Manila/Asia timezone). Window wraps midnight if from > to.';

-- Seed defaults for the default hotel
UPDATE public.notification_settings
SET
  suppress_if_active    = true,
  push_cooldown_seconds = 30,
  quiet_hours_enabled   = false,
  quiet_hours_from      = 22,
  quiet_hours_to        = 7
WHERE hotel_id = '00000000-0000-0000-0000-000000000001';

-- â”€â”€ 3. staff_users â€” per-staff notification preferences â”€â”€â”€â”€â”€â”€
ALTER TABLE public.staff_users
  -- Completely mute all guest chat FCM pushes for this staff account
  ADD COLUMN IF NOT EXISTS mute_guest_chat_push       BOOLEAN NOT NULL DEFAULT false,

  -- Suppress push only when this staff member is actively viewing that conversation
  ADD COLUMN IF NOT EXISTS suppress_push_when_active  BOOLEAN NOT NULL DEFAULT true,

  -- Optional personal quiet hours override (null = inherit hotel setting)
  ADD COLUMN IF NOT EXISTS quiet_hours_from_override  INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_to_override    INT DEFAULT NULL;

COMMENT ON COLUMN public.staff_users.mute_guest_chat_push       IS 'When true, this staff member receives no FCM pushes for guest chat events (both GUEST_CHAT and CHAT_HANDOFF)';
COMMENT ON COLUMN public.staff_users.suppress_push_when_active  IS 'When true, FCM is held for this staff member while they are actively viewing the affected conversation';
COMMENT ON COLUMN public.staff_users.quiet_hours_from_override  IS 'Personal quiet hours start (0-23). Overrides hotel setting when not null.';
COMMENT ON COLUMN public.staff_users.quiet_hours_to_override    IS 'Personal quiet hours end (0-23). Overrides hotel setting when not null.';

-- â”€â”€ 4. guest_conversations â€” push cooldown tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE public.guest_conversations
  -- Timestamp of the last FCM push dispatched for this conversation (for cooldown enforcement)
  ADD COLUMN IF NOT EXISTS last_push_sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.guest_conversations.last_push_sent_at IS
  'Timestamp of the last successfully dispatched FCM push for this conversation. Used to enforce push_cooldown_seconds between routine GUEST_CHAT notifications.';

CREATE INDEX IF NOT EXISTS idx_guest_conversations_last_push
  ON public.guest_conversations (id, last_push_sent_at)
  WHERE last_push_sent_at IS NOT NULL;


