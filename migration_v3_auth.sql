-- Migration: Authentication System


-- User roles and status tracking
CREATE TABLE IF NOT EXISTS app_users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Pending access requests
CREATE TABLE IF NOT EXISTS access_requests (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

-- RLS
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service full access to app_users"
  ON app_users FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow service full access to access_requests"
  ON access_requests FOR ALL USING (true) WITH CHECK (true);
