-- Rollback of 20261009090000_session_extra_banks. Sessions keep their primary bank; only the extra banks are forgotten.
ALTER TABLE "Session" DROP COLUMN IF EXISTS "extraBankIds";
