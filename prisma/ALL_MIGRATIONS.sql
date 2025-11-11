-- ============================================
-- ALL REQUIRED MIGRATIONS FOR IPREP
-- Run these on your production database
-- ============================================

-- 1. Add frequentlyForgottenPoints to LearningSummary (REQUIRED - fixes current error)
ALTER TABLE "LearningSummary"
ADD COLUMN IF NOT EXISTS "frequentlyForgottenPoints" JSONB;

-- 2. Add dontForget to SessionItem (if not already done)
ALTER TABLE "SessionItem" 
ADD COLUMN IF NOT EXISTS "dontForget" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "SessionItem" 
SET "dontForget" = ARRAY[]::TEXT[] 
WHERE "dontForget" IS NULL;

-- 3. Add filterTags to Session (if not already done)
ALTER TABLE "Session" 
ADD COLUMN IF NOT EXISTS "filterTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "Session" 
SET "filterTags" = ARRAY[]::TEXT[] 
WHERE "filterTags" IS NULL;

-- 4. Add topForgottenPoints to UserLearningInsight (you already did this)
-- ALTER TABLE "UserLearningInsight" 
-- ADD COLUMN IF NOT EXISTS "topForgottenPoints" JSONB;

-- ============================================
-- VERIFICATION QUERIES (optional - run to check)
-- ============================================

-- Check if frequentlyForgottenPoints exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'LearningSummary' 
AND column_name = 'frequentlyForgottenPoints';

-- Check if dontForget exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'SessionItem' 
AND column_name = 'dontForget';

-- Check if filterTags exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'Session' 
AND column_name = 'filterTags';

-- Check if topForgottenPoints exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'UserLearningInsight' 
AND column_name = 'topForgottenPoints';

