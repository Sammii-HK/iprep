-- Add filterTags column to Session table for weak topics practice
ALTER TABLE "Session" 
ADD COLUMN IF NOT EXISTS "filterTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Update existing sessions to have empty array if NULL
UPDATE "Session" 
SET "filterTags" = ARRAY[]::TEXT[] 
WHERE "filterTags" IS NULL;

