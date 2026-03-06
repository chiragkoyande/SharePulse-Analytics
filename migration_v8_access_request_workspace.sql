-- ============================================
-- Migration v8: Access Request Workspace Binding
-- ============================================

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'access_requests_workspace_id_fkey'
      AND table_name = 'access_requests'
  ) THEN
    ALTER TABLE access_requests
      ADD CONSTRAINT access_requests_workspace_id_fkey
      FOREIGN KEY (workspace_id)
      REFERENCES workspaces(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_access_requests_workspace_id
  ON access_requests(workspace_id);
