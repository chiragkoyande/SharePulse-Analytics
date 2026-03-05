-- ============================================
-- Migration v4: Access Requests with User Password
-- ============================================
-- Users provide password during request-access flow.
-- Password is stored encrypted in access_requests.encrypted_password.
-- Admin UI only reads email/status/date.
-- ============================================

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS encrypted_password TEXT;

-- Optional safety: do not keep encrypted password once approved/rejected.
UPDATE access_requests
SET encrypted_password = NULL
WHERE status IN ('approved', 'rejected');
