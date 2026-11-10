-- Phase 1 go-live, step 4 (D11): every existing account chooses a new password
-- that meets the D5 rules at its next sign-in. Reason "policy_upgrade" means no
-- 72-hour expiry applies, so the current password keeps working until then.
-- Accounts already waiting on a temporary password are left alone.
update public.profiles
set must_change_password = true,
    must_change_reason = 'policy_upgrade',
    temp_password_expires_at = null
where not must_change_password;
