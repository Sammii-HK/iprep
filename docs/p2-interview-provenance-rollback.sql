-- Rollback of 20261008120000_interview_provenance. Interviews keep working; they just stop carrying source provenance.
ALTER TABLE "Interview" DROP COLUMN IF EXISTS "sourceUpdatedAt";
ALTER TABLE "Interview" DROP COLUMN IF EXISTS "timeZone";
