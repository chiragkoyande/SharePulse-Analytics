-- ============================================
-- Migration v2: Security & Ranking Features
-- ============================================
-- Run this in Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query)
-- ============================================

-- Step 1: Add new columns (safe — won't fail if rows exist)
ALTER TABLE resources ADD COLUMN IF NOT EXISTS url_hash TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS dislike_count INTEGER DEFAULT 0;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 1;

-- Step 2: Backfill url_hash and domain from existing URLs
UPDATE resources
SET
  url_hash = md5(lower(url)),
  domain   = substring(url FROM 'https?://([^/]+)')
WHERE url_hash IS NULL;

-- Step 3: Make url_hash NOT NULL and UNIQUE now that all rows have it
ALTER TABLE resources ALTER COLUMN url_hash SET NOT NULL;
ALTER TABLE resources ADD CONSTRAINT resources_url_hash_unique UNIQUE (url_hash);

-- Step 4: Drop old PII columns
ALTER TABLE resources DROP COLUMN IF EXISTS context;
ALTER TABLE resources DROP COLUMN IF EXISTS sender;
ALTER TABLE resources DROP COLUMN IF EXISTS group_name;
ALTER TABLE resources DROP COLUMN IF EXISTS is_duplicate;

-- Step 5: Create index for hash lookups
CREATE INDEX IF NOT EXISTS idx_url_hash ON resources(url_hash);

-- Step 6: Ensure RLS policies cover updates (for voting)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resources' AND policyname = 'Allow service update'
  ) THEN
    CREATE POLICY "Allow service update" ON resources FOR UPDATE USING (true);
  END IF;
END
$$;
