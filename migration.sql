-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- DropForeignKey
ALTER TABLE "LearningSummary" DROP CONSTRAINT "LearningSummary_userId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSummary" DROP CONSTRAINT "LearningSummary_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "UserLearningInsight" DROP CONSTRAINT "UserLearningInsight_userId_fkey";

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "emailVerificationToken",
DROP COLUMN "emailVerified",
DROP COLUMN "isPremium",
DROP COLUMN "password",
DROP COLUMN "passwordResetExpires",
DROP COLUMN "passwordResetToken",
DROP COLUMN "role",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "public"."Session" DROP COLUMN "completedAt",
DROP COLUMN "isCompleted";

-- DropTable
DROP TABLE "LearningSummary";

-- DropTable
DROP TABLE "UserLearningInsight";

-- DropEnum
DROP TYPE "UserRole";

