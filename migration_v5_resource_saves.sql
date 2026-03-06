-- Migration: User-saved Resources


CREATE TABLE IF NOT EXISTS resource_saves (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL,
  url_hash    TEXT NOT NULL REFERENCES resources(url_hash) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_resource_saves_url_hash ON resource_saves(url_hash);
CREATE INDEX IF NOT EXISTS idx_resource_saves_user_id ON resource_saves(user_id);

ALTER TABLE resource_saves ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_saves' AND policyname = 'Allow service read saves'
  ) THEN
    CREATE POLICY "Allow service read saves" ON resource_saves FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_saves' AND policyname = 'Allow service write saves'
  ) THEN
    CREATE POLICY "Allow service write saves" ON resource_saves FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_saves' AND policyname = 'Allow service delete saves'
  ) THEN
    CREATE POLICY "Allow service delete saves" ON resource_saves FOR DELETE USING (true);
  END IF;
END
$$;
