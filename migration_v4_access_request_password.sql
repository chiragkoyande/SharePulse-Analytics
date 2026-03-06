-- Migration: Access Requests with User Password


ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS encrypted_password TEXT;

-- Optional safety: do not keep encrypted password once approved/rejected.
UPDATE access_requests
SET encrypted_password = NULL
WHERE status IN ('approved', 'rejected');
