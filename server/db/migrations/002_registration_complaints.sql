-- =====================================================================
-- 002: self-registration with approval, profile fields, complaints,
--      and the permissions for the new admin / warden features.
-- Safe to run on a database that already holds data.
-- =====================================================================

CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE complaint_category AS ENUM ('ELECTRICAL', 'PLUMBING', 'FURNITURE', 'CLEANING', 'INTERNET', 'OTHER');
CREATE TYPE complaint_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE complaint_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- Existing accounts stay APPROVED; self-registered students start PENDING.
ALTER TABLE users ADD COLUMN approval_status approval_status NOT NULL DEFAULT 'APPROVED';
ALTER TABLE users ADD COLUMN phone VARCHAR(15);
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
-- Admin's "pending registrations" queue.
CREATE INDEX idx_users_pending ON users(created_at) WHERE approval_status = 'PENDING';

CREATE TABLE complaints (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_id     INT NOT NULL REFERENCES rooms(id),
  category    complaint_category NOT NULL,
  priority    complaint_priority NOT NULL DEFAULT 'MEDIUM',
  title       VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  status      complaint_status NOT NULL DEFAULT 'OPEN',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
-- Warden queue: open complaints of rooms in one hostel, newest first (joined via room).
CREATE INDEX idx_complaints_room_status ON complaints(room_id, status);
-- Student's own complaints.
CREATE INDEX idx_complaints_student ON complaints(student_id, created_at DESC);

-- Timeline of every status change and note on a complaint.
CREATE TABLE complaint_events (
  id           SERIAL PRIMARY KEY,
  complaint_id INT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id     INT NOT NULL REFERENCES users(id),
  from_status  complaint_status,
  to_status    complaint_status NOT NULL,
  note         VARCHAR(500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_complaint_events ON complaint_events(complaint_id, created_at);

-- New permissions. On a fresh database the roles do not exist yet; the seed adds them.
INSERT INTO permissions(code) VALUES
  ('complaint:create'), ('complaint:manage'), ('student:read'), ('student:approve'),
  ('user:manage'), ('hostel:manage'), ('dashboard:read')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
  (r.name = 'student' AND p.code IN ('complaint:create')) OR
  (r.name = 'warden'  AND p.code IN ('complaint:manage', 'student:read', 'dashboard:read')) OR
  (r.name = 'admin'   AND p.code IN ('complaint:manage', 'student:read', 'student:approve', 'user:manage', 'hostel:manage', 'dashboard:read'))
ON CONFLICT DO NOTHING;
