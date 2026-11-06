-- =====================================================================
-- Hostel Room Allocation System — initial schema (PostgreSQL)
-- Audit logs and notifications live in MongoDB, not here.
-- =====================================================================

CREATE TYPE gender AS ENUM ('MALE', 'FEMALE');
CREATE TYPE round_status AS ENUM ('DRAFT', 'PREFERENCES_OPEN', 'ALLOCATED', 'BOOKING_OPEN', 'CLOSED');
CREATE TYPE allocation_status AS ENUM ('ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'VACATED', 'RELEASED', 'SWAPPED');
CREATE TYPE allocation_source AS ENUM ('PRIORITY', 'OPEN_BOOKING', 'SWAP', 'LEGACY');
CREATE TYPE swap_status AS ENUM ('PENDING_PEER', 'PENDING_WARDEN', 'APPROVED', 'REJECTED', 'CANCELLED');

-- ---------- Identity & RBAC ----------
CREATE TABLE roles (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE permissions (
  id   SERIAL PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- FK join users -> roles when building token claims.
CREATE INDEX idx_users_role ON users(role_id);

CREATE TABLE refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Reuse detection revokes every token of a user in one UPDATE.
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ---------- Students ----------
CREATE TABLE students (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  roll_no  VARCHAR(20) NOT NULL UNIQUE,
  gender   gender NOT NULL,
  year     INT NOT NULL CHECK (year BETWEEN 1 AND 5),
  program  VARCHAR(40) NOT NULL,
  cgpa     NUMERIC(4,2) NOT NULL CHECK (cgpa BETWEEN 0 AND 10),
  is_pwd   BOOLEAN NOT NULL DEFAULT FALSE
);
-- Round 1 priority ordering: PwD first, then seniority, then CGPA.
CREATE INDEX idx_students_priority ON students(is_pwd DESC, year DESC, cgpa DESC);

-- ---------- Hostels, rooms, beds ----------
CREATE TABLE hostels (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80) NOT NULL UNIQUE,
  code          VARCHAR(10) NOT NULL UNIQUE,
  gender        gender NOT NULL,
  allowed_years INT[] NOT NULL,
  warden_id     INT UNIQUE REFERENCES users(id)
);

CREATE TABLE rooms (
  id        SERIAL PRIMARY KEY,
  hostel_id INT NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_no   VARCHAR(10) NOT NULL,
  floor     INT NOT NULL,
  capacity  INT NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  UNIQUE (hostel_id, room_no)
);
-- Room browser: rooms of one hostel, optionally one floor.
CREATE INDEX idx_rooms_hostel_floor ON rooms(hostel_id, floor);

-- The unit being allocated is a BED, not a room (copy-level modelling).
CREATE TABLE beds (
  id      SERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label   VARCHAR(4) NOT NULL,
  UNIQUE (room_id, label)
);

-- ---------- Allocation cycle ----------
CREATE TABLE allocation_rounds (
  id              SERIAL PRIMARY KEY,
  session         VARCHAR(9) NOT NULL UNIQUE,      -- e.g. 2026-27
  name            VARCHAR(80) NOT NULL,
  status          round_status NOT NULL DEFAULT 'DRAFT',
  fee_window_days INT NOT NULL DEFAULT 7 CHECK (fee_window_days BETWEEN 1 AND 60),
  allocated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE preferences (
  id         SERIAL PRIMARY KEY,
  round_id   INT NOT NULL REFERENCES allocation_rounds(id) ON DELETE CASCADE,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_id    INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  rank       INT NOT NULL CHECK (rank BETWEEN 1 AND 5),
  UNIQUE (round_id, student_id, rank),
  UNIQUE (round_id, student_id, room_id)
);

CREATE TABLE allocations (
  id         SERIAL PRIMARY KEY,
  session    VARCHAR(9) NOT NULL,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  bed_id     INT NOT NULL REFERENCES beds(id),
  round_id   INT REFERENCES allocation_rounds(id),
  status     allocation_status NOT NULL DEFAULT 'ALLOCATED',
  source     allocation_source NOT NULL,
  fee_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One ACTIVE bed per student per session.
CREATE UNIQUE INDEX uq_alloc_active_student ON allocations(session, student_id)
  WHERE status IN ('ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN');

-- One ACTIVE student per bed per session. Second line of defence behind
-- the SELECT ... FOR UPDATE SKIP LOCKED booking query.
CREATE UNIQUE INDEX uq_alloc_active_bed ON allocations(session, bed_id)
  WHERE status IN ('ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN');

-- Warden/admin list view filters by session + status, ordered by newest.
CREATE INDEX idx_alloc_session_status ON allocations(session, status, created_at DESC);
-- Student history and join from beds.
CREATE INDEX idx_alloc_student ON allocations(student_id);
CREATE INDEX idx_alloc_bed ON allocations(bed_id);
-- Cron job: find unpaid allocations past their deadline.
CREATE INDEX idx_alloc_fee_due ON allocations(fee_due_at) WHERE status = 'ALLOCATED';

CREATE TABLE swap_requests (
  id                 SERIAL PRIMARY KEY,
  session            VARCHAR(9) NOT NULL,
  requester_alloc_id INT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  target_alloc_id    INT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  status             swap_status NOT NULL DEFAULT 'PENDING_PEER',
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_alloc_id <> target_alloc_id)
);
-- Pending-swap lookups by either side of the swap.
CREATE INDEX idx_swap_requester ON swap_requests(requester_alloc_id);
CREATE INDEX idx_swap_target ON swap_requests(target_alloc_id);

CREATE TABLE fee_receipts (
  id            SERIAL PRIMARY KEY,
  allocation_id INT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  file_path     VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(60) NOT NULL,
  size_bytes    INT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by   INT REFERENCES users(id),
  verified_at   TIMESTAMPTZ
);
-- Latest receipt of an allocation (verify / download).
CREATE INDEX idx_receipts_alloc ON fee_receipts(allocation_id);
