-- DropForeignKey
ALTER TABLE "public"."QuestionBank" DROP CONSTRAINT "QuestionBank_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Quiz" DROP CONSTRAINT "Quiz_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Session" DROP CONSTRAINT "Session_userId_fkey";

-- CreateTable
CREATE TABLE "MachinePrincipal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MachinePrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineAudit" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "MachinePrincipal_name_key" ON "MachinePrincipal"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MachinePrincipal_tokenHash_key" ON "MachinePrincipal"("tokenHash");

-- CreateIndex
CREATE INDEX "MachinePrincipal_userId_idx" ON "MachinePrincipal"("userId");

-- CreateIndex
CREATE INDEX "MachineAudit_principalId_at_idx" ON "MachineAudit"("principalId", "at");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePrincipal" ADD CONSTRAINT "MachinePrincipal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAudit" ADD CONSTRAINT "MachineAudit_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "MachinePrincipal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical emails. Registration lowercased the email only for the admin comparison but stored it as typed,
-- so a case variant of an existing address created a second identity. Store emails lowercased and enforce it
-- in the database. If two existing accounts differed only by case, the UPDATE fails on the unique index and
-- this migration aborts without changing anything (production has none).
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(btrim("email"));

ALTER TABLE "User" ADD CONSTRAINT "User_email_canonical_chk" CHECK ("email" IS NULL OR "email" = lower(btrim("email")));
