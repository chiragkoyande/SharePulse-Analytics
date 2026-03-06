-- Database Schema


CREATE TABLE IF NOT EXISTS resources (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url         TEXT NOT NULL,
  url_hash    TEXT UNIQUE NOT NULL,
  title       TEXT DEFAULT 'New Resource',
  domain      TEXT,
  like_count  INTEGER DEFAULT 0,
  dislike_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_votes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL,
  url_hash    TEXT NOT NULL REFERENCES resources(url_hash) ON DELETE CASCADE,
  vote        TEXT NOT NULL CHECK (vote IN ('like', 'dislike')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, url_hash)
);

CREATE TABLE IF NOT EXISTS resource_saves (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL,
  url_hash    TEXT NOT NULL REFERENCES resources(url_hash) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_url_hash ON resources(url_hash);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_votes_url_hash ON resource_votes(url_hash);
CREATE INDEX IF NOT EXISTS idx_resource_votes_user_id ON resource_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_saves_url_hash ON resource_saves(url_hash);
CREATE INDEX IF NOT EXISTS idx_resource_saves_user_id ON resource_saves(user_id);

-- Enable RLS with public read access
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_saves ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resources' AND policyname = 'Allow public read'
  ) THEN
    CREATE POLICY "Allow public read" ON resources FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resources' AND policyname = 'Allow service insert'
  ) THEN
    CREATE POLICY "Allow service insert" ON resources FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resources' AND policyname = 'Allow service update'
  ) THEN
    CREATE POLICY "Allow service update" ON resources FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_votes' AND policyname = 'Allow service read votes'
  ) THEN
    CREATE POLICY "Allow service read votes" ON resource_votes FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_votes' AND policyname = 'Allow service write votes'
  ) THEN
    CREATE POLICY "Allow service write votes" ON resource_votes FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_votes' AND policyname = 'Allow service update votes'
  ) THEN
    CREATE POLICY "Allow service update votes" ON resource_votes FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_saves' AND policyname = 'Allow service read saves'
  ) THEN
    CREATE POLICY "Allow service read saves" ON resource_saves FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_saves' AND policyname = 'Allow service write saves'
  ) THEN
    CREATE POLICY "Allow service write saves" ON resource_saves FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resource_saves' AND policyname = 'Allow service delete saves'
  ) THEN
    CREATE POLICY "Allow service delete saves" ON resource_saves FOR DELETE USING (true);
  END IF;
END
$$;
