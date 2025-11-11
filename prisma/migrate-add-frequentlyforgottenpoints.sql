-- Add frequentlyForgottenPoints column to LearningSummary table
ALTER TABLE "LearningSummary"
ADD COLUMN IF NOT EXISTS "frequentlyForgottenPoints" JSONB;

-- Set default to NULL for existing rows (already NULL by default, but explicit)
UPDATE "LearningSummary"
SET "frequentlyForgottenPoints" = NULL
WHERE "frequentlyForgottenPoints" IS NULL;

