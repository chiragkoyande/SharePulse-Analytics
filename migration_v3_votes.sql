-- Migration: One Vote Per User Per Link


CREATE TABLE IF NOT EXISTS resource_votes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL,
  url_hash    TEXT NOT NULL REFERENCES resources(url_hash) ON DELETE CASCADE,
  vote        TEXT NOT NULL CHECK (vote IN ('like', 'dislike')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_resource_votes_url_hash ON resource_votes(url_hash);
CREATE INDEX IF NOT EXISTS idx_resource_votes_user_id ON resource_votes(user_id);

ALTER TABLE resource_votes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_votes' AND policyname = 'Allow service read votes'
  ) THEN
    CREATE POLICY "Allow service read votes" ON resource_votes FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_votes' AND policyname = 'Allow service write votes'
  ) THEN
    CREATE POLICY "Allow service write votes" ON resource_votes FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resource_votes' AND policyname = 'Allow service update votes'
  ) THEN
    CREATE POLICY "Allow service update votes" ON resource_votes FOR UPDATE USING (true);
  END IF;
END
$$;

-- Backfill current resource counts to keep values in sync.
UPDATE resources r
SET
  like_count = COALESCE(v.likes, 0),
  dislike_count = COALESCE(v.dislikes, 0)
FROM (
  SELECT
    url_hash,
    COUNT(*) FILTER (WHERE vote = 'like') AS likes,
    COUNT(*) FILTER (WHERE vote = 'dislike') AS dislikes
  FROM resource_votes
  GROUP BY url_hash
) v
WHERE r.url_hash = v.url_hash;
