-- Landblaze Engine v3.5: strict onboarding, departmental navigation, staff profiles.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL;
-- Existing accounts with a PIN already use PIN login. Accounts without a PIN remain eligible for email/password first-time setup.
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
CREATE INDEX IF NOT EXISTS idx_users_avatar ON users(avatar_file_id);
