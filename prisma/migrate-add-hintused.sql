-- Add hintUsed column to QuizAttempt table
ALTER TABLE "QuizAttempt" 
ADD COLUMN IF NOT EXISTS "hintUsed" BOOLEAN DEFAULT false;

-- Update existing rows to have false if null
UPDATE "QuizAttempt" 
SET "hintUsed" = false 
WHERE "hintUsed" IS NULL;

