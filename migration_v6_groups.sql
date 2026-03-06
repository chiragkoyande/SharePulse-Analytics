-- Migration: Multi-Group Workspace Support


-- Step 1: Create groups table
CREATE TABLE IF NOT EXISTS groups (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  whatsapp_group_id TEXT UNIQUE,
  description     TEXT DEFAULT '',
  color           TEXT DEFAULT '#0ea5e9',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Step 2: Insert a "Default" group for existing resources
INSERT INTO groups (id, name, whatsapp_group_id, description, color)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default',
  NULL,
  'Default workspace for existing resources',
  '#0ea5e9'
)
ON CONFLICT (id) DO NOTHING;

-- Step 3: Add group_id column to resources
ALTER TABLE resources ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- Step 4: Backfill existing resources into Default group
UPDATE resources
SET group_id = '00000000-0000-0000-0000-000000000001'
WHERE group_id IS NULL;

-- Step 5: Create index for group-based queries
CREATE INDEX IF NOT EXISTS idx_resources_group_id ON resources(group_id);

-- Step 6: Enable RLS on groups table
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Step 7: RLS policies for groups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'Allow public read groups'
  ) THEN
    CREATE POLICY "Allow public read groups" ON groups FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'Allow service insert groups'
  ) THEN
    CREATE POLICY "Allow service insert groups" ON groups FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'Allow service update groups'
  ) THEN
    CREATE POLICY "Allow service update groups" ON groups FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'Allow service delete groups'
  ) THEN
    CREATE POLICY "Allow service delete groups" ON groups FOR DELETE USING (true);
  END IF;
END
$$;
