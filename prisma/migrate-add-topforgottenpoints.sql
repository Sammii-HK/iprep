-- Add topForgottenPoints column to UserLearningInsight table
ALTER TABLE "UserLearningInsight" 
ADD COLUMN IF NOT EXISTS "topForgottenPoints" JSONB;

