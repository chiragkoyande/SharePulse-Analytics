-- ============================================
-- Migration v7: Workspace Multi-Tenancy
-- ============================================
-- Run this in Supabase SQL Editor AFTER v6.
-- Creates workspaces, workspace_members,
-- workspace_groups and migrates resources.
-- ============================================

-- Step 1: Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#0ea5e9',
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Step 2: Create workspace_members table
CREATE TABLE IF NOT EXISTS workspace_members (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, user_email)
);

-- Step 3: Create workspace_groups table
CREATE TABLE IF NOT EXISTS workspace_groups (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  whatsapp_group_id TEXT UNIQUE NOT NULL,
  name              TEXT DEFAULT 'Unnamed Group',
  status            TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Step 4: Add super_admin role support to app_users
-- Drop the existing role check constraint and recreate with super_admin
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'user'));

-- Update existing admin to super_admin
UPDATE app_users SET role = 'super_admin' WHERE email = 'chiragkoyande4@gmail.com';

-- Step 5: Add workspace_id to resources (if group_id exists, rename it)
DO $$
BEGIN
  -- If group_id column exists (from v6), rename to workspace_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resources' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE resources RENAME COLUMN group_id TO workspace_id;
    -- Drop the old FK constraint if it exists
    ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_group_id_fkey;
  ELSE
    -- Add workspace_id column if neither exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'resources' AND column_name = 'workspace_id'
    ) THEN
      ALTER TABLE resources ADD COLUMN workspace_id UUID;
    END IF;
  END IF;
END $$;

-- Step 6: Create Default workspace FIRST (before FK constraint)
INSERT INTO workspaces (id, name, slug, description, color, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Workspace',
  'default',
  'Default workspace for existing resources',
  '#0ea5e9',
  'chiragkoyande4@gmail.com'
)
ON CONFLICT (id) DO NOTHING;

-- Backfill resources without workspace_id into default workspace
UPDATE resources SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

-- Null out any workspace_ids that don't exist in the workspaces table
UPDATE resources SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NOT NULL
  AND workspace_id NOT IN (SELECT id FROM workspaces);

-- Step 7: NOW add FK constraint (all values are valid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'resources_workspace_id_fkey'
  ) THEN
    ALTER TABLE resources ADD CONSTRAINT resources_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add super_admin as workspace owner
INSERT INTO workspace_members (workspace_id, user_email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'chiragkoyande4@gmail.com', 'owner')
ON CONFLICT (workspace_id, user_email) DO NOTHING;

-- Step 8: Create indexes
CREATE INDEX IF NOT EXISTS idx_resources_workspace_id ON resources(workspace_id);
DROP INDEX IF EXISTS idx_resources_group_id;
CREATE INDEX IF NOT EXISTS idx_workspace_members_email ON workspace_members(user_email);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_groups_workspace ON workspace_groups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_groups_wa_id ON workspace_groups(whatsapp_group_id);

-- Step 9: Enable RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_groups ENABLE ROW LEVEL SECURITY;

-- Step 10: RLS policies
DO $$
BEGIN
  -- Workspaces
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspaces' AND policyname = 'Allow service all workspaces') THEN
    CREATE POLICY "Allow service all workspaces" ON workspaces FOR ALL USING (true) WITH CHECK (true);
  END IF;
  -- Workspace members
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_members' AND policyname = 'Allow service all workspace_members') THEN
    CREATE POLICY "Allow service all workspace_members" ON workspace_members FOR ALL USING (true) WITH CHECK (true);
  END IF;
  -- Workspace groups
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_groups' AND policyname = 'Allow service all workspace_groups') THEN
    CREATE POLICY "Allow service all workspace_groups" ON workspace_groups FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Step 11: Drop old groups table if it exists (from v6)
-- Resources FK was already moved to workspaces
DROP TABLE IF EXISTS groups CASCADE;
