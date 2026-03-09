-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyGoal" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "interviewDate" TIMESTAMP(3),
ADD COLUMN     "lastStudiedDate" TIMESTAMP(3),
ADD COLUMN     "longestStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserQuestionProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "nextReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lastScore" DOUBLE PRECISION,
    "lastPracticed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserQuestionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserQuestionProgress_userId_nextReviewAt_idx" ON "UserQuestionProgress"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuestionProgress_userId_questionId_key" ON "UserQuestionProgress"("userId", "questionId");

-- AddForeignKey
ALTER TABLE "UserQuestionProgress" ADD CONSTRAINT "UserQuestionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuestionProgress" ADD CONSTRAINT "UserQuestionProgress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
