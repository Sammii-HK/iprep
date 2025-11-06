-- Migration to add authentication and learning analytics features
-- Run this on your production database

-- Create UserRole enum
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to User table
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "password" TEXT,
ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN IF NOT EXISTS "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT,
ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT,
ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add new columns to Session table
ALTER TABLE "Session"
ADD COLUMN IF NOT EXISTS "isCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- Create LearningSummary table
CREATE TABLE IF NOT EXISTS "LearningSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bankId" TEXT,
    "commonMistakes" JSONB NOT NULL,
    "weakTags" TEXT[] NOT NULL,
    "strongTags" TEXT[] NOT NULL,
    "recommendedFocus" TEXT[] NOT NULL,
    "performanceByTag" JSONB NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningSummary_pkey" PRIMARY KEY ("id")
);

-- Create UserLearningInsight table
CREATE TABLE IF NOT EXISTS "UserLearningInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aggregatedWeakTags" TEXT[] NOT NULL,
    "aggregatedStrongTags" TEXT[] NOT NULL,
    "topFocusAreas" TEXT[] NOT NULL,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLearningInsight_pkey" PRIMARY KEY ("id")
);

-- Create unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "LearningSummary_sessionId_key" ON "LearningSummary"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserLearningInsight_userId_key" ON "UserLearningInsight"("userId");

-- Add foreign keys
DO $$ BEGIN
    ALTER TABLE "LearningSummary" ADD CONSTRAINT "LearningSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LearningSummary" ADD CONSTRAINT "LearningSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "UserLearningInsight" ADD CONSTRAINT "UserLearningInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

