-- First (super) administrator, created directly so you can log in immediately after
-- deploy. SUPER_ADMIN is the top tier: only this tier can create/change/deactivate
-- other admin-tier accounts and manage departments; a plain ADMIN cannot touch
-- another admin account, which is the whole point of the tier.
--
--   Email:    admin@landblaze.com
--   Password: EXperts2020!
--
-- Run this AFTER db/schema.sql (and after db/upgrade-v2-to-v3.sql if migrating from v2).
-- Idempotent: re-running it just resets this account back to the password above.
--
-- IMPORTANT: this exact password is sitting in plain text in this file, in your repo.
-- Log in once, then immediately go to "Change password" (bottom of the sidebar) and
-- set a real password only you know. Do not leave this as the production password.

insert into users (name, email, password_hash, role, department, active, must_change_password)
values (
  'Super Administrator',
  'admin@landblaze.com',
  '$2b$12$mNqhkLu86WQWdsSamNVJZumLgGnKakNJ5Z64eeO/yOYhjbbFE4GH2',  -- bcrypt hash of: EXperts2020!
  'SUPER_ADMIN',
  'Management',
  true,
  false   -- false = log in straight to the dashboard, no forced change. Change it yourself right after.
)
on conflict (email) do update set
  password_hash = excluded.password_hash,
  role = 'SUPER_ADMIN',
  active = true,
  must_change_password = false,
  updated_at = now();
