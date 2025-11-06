-- Migration: Add dontForget column to SessionItem table
-- Run this migration on your production database

-- Add the dontForget column as a text array (PostgreSQL array type)
ALTER TABLE "SessionItem" 
ADD COLUMN IF NOT EXISTS "dontForget" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Update existing rows to have an empty array if null
UPDATE "SessionItem" 
SET "dontForget" = ARRAY[]::TEXT[] 
WHERE "dontForget" IS NULL;

