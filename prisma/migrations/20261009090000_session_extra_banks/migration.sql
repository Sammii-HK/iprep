-- AlterTable: multi-bank practice sessions.
-- Additive with a default: existing sessions and old clients are unaffected. "bankId" remains the primary bank,
-- so every existing reader of Session.bank keeps working; extra banks only widen the question pool.
ALTER TABLE "Session" ADD COLUMN     "extraBankIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
