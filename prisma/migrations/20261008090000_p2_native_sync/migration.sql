-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "clientEventId" TEXT,
ADD COLUMN     "clientRef" JSONB,
ADD COLUMN     "contentLinkage" TEXT NOT NULL DEFAULT 'n/a',
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "evaluationRequested" BOOLEAN,
ADD COLUMN     "occurredAtSkewMs" INTEGER,
ADD COLUMN     "occurredAtSuspect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "questionRevisionId" TEXT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "externalKey" TEXT;

-- AlterTable
ALTER TABLE "AttemptEvidence" ADD COLUMN     "durationMs" INTEGER;

-- AlterTable
ALTER TABLE "QuestionBank" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "externalKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuestionRevision" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "hint" TEXT,
    "tags" TEXT[],
    "difficulty" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "emailAtLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeInvite" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "note" TEXT,

    CONSTRAINT "NativeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLinkCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AccountLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeRefreshToken" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "NativeRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncChange" (
    "id" BIGSERIAL NOT NULL,
    "txid" BIGINT NOT NULL DEFAULT (pg_current_xact_id())::text::bigint,
    "learnerId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'upsert',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEpoch" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "epoch" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SyncEpoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEventLog" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "eventId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "errorCode" TEXT,
    "payloadHash" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionReceipt" (
    "id" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counts" JSONB NOT NULL,

    CONSTRAINT "AccountDeletionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_questionId_revision_key" ON "QuestionRevision"("questionId", "revision");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "NativeInvite_codeHash_key" ON "NativeInvite"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLinkCode_codeHash_key" ON "AccountLinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "AccountLinkCode_userId_idx" ON "AccountLinkCode"("userId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NativeRefreshToken_tokenHash_key" ON "NativeRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "NativeRefreshToken_deviceId_idx" ON "NativeRefreshToken"("deviceId");

-- CreateIndex
CREATE INDEX "SyncChange_learnerId_txid_id_idx" ON "SyncChange"("learnerId", "txid", "id");

-- CreateIndex
CREATE INDEX "SyncEventLog_learnerId_receivedAt_idx" ON "SyncEventLog"("learnerId", "receivedAt");

-- CreateIndex
CREATE INDEX "SyncEventLog_learnerId_eventId_idx" ON "SyncEventLog"("learnerId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_learnerId_clientEventId_key" ON "Attempt"("learnerId", "clientEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_bankId_externalKey_key" ON "Question"("bankId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBank_userId_externalKey_key" ON "QuestionBank"("userId", "externalKey");

-- AddForeignKey
ALTER TABLE "QuestionRevision" ADD CONSTRAINT "QuestionRevision_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "QuestionRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLinkCode" ADD CONSTRAINT "AccountLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeRefreshToken" ADD CONSTRAINT "NativeRefreshToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================================================
-- Invariants the schema language cannot express
-- ============================================================================================================

-- At most one ACTIVE Apple identity per user (a revoked one does not count).
CREATE UNIQUE INDEX "AuthIdentity_one_active_per_user_provider_key"
  ON "AuthIdentity"("userId", "provider") WHERE "revokedAt" IS NULL;

-- A catalog (shared) bank is identified by its external key alone: NULL owners are distinct in a plain unique.
CREATE UNIQUE INDEX "QuestionBank_shared_externalKey_key"
  ON "QuestionBank"("externalKey") WHERE "userId" IS NULL AND "externalKey" IS NOT NULL;

ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_contentLinkage_chk"
  CHECK ("contentLinkage" IN ('linked', 'unlinked', 'n/a'));

-- A question revision is immutable (it is what a learner was shown). Deleting a question still cascades.
CREATE FUNCTION "question_revision_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('iprep.ledger_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'QuestionRevision is immutable: edit by adding a new revision' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER "QuestionRevision_immutable" BEFORE UPDATE ON "QuestionRevision"
  FOR EACH ROW EXECUTE FUNCTION "question_revision_immutable"();

-- The Attempt append-only guard from P1, with the P2 reference columns that may be cleared by ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION "attempt_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  refs text[] := ARRAY['goalId', 'questionId', 'bankId', 'sessionId', 'actorPrincipalId', 'deviceId', 'questionRevisionId'];
  col text;
BEGIN
  IF current_setting('iprep.ledger_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - refs) IS NOT DISTINCT FROM (to_jsonb(OLD) - refs) THEN
      FOREACH col IN ARRAY refs LOOP
        IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) AND (to_jsonb(NEW) -> col) <> 'null'::jsonb THEN
          RAISE EXCEPTION 'Attempt is append-only: % may only be cleared, not changed', col USING ERRCODE = 'restrict_violation';
        END IF;
      END LOOP;
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Attempt is append-only: % refused (maintenance sessions set iprep.ledger_maintenance = on)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- An attempt can only point at a revision of the question it names. The application sets both from one resolution,
-- but the database makes a mismatch impossible, so a bug or a forged payload can never attach evidence to another
-- question's revision.
CREATE FUNCTION "attempt_revision_consistency"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rev_question text;
BEGIN
  IF NEW."questionRevisionId" IS NOT NULL THEN
    SELECT "questionId" INTO rev_question FROM "QuestionRevision" WHERE "id" = NEW."questionRevisionId";
    IF NEW."questionId" IS NULL OR rev_question IS DISTINCT FROM NEW."questionId" THEN
      RAISE EXCEPTION 'Attempt.questionRevisionId must be a revision of Attempt.questionId' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Attempt_revision_consistency" BEFORE INSERT ON "Attempt"
  FOR EACH ROW EXECUTE FUNCTION "attempt_revision_consistency"();

-- ============================================================================================================
-- Backfills (idempotent, nothing invented)
-- ============================================================================================================

-- Every existing question gets revision 1 with exactly its current content.
INSERT INTO "QuestionRevision" ("id", "questionId", "revision", "text", "hint", "tags", "difficulty", "type")
SELECT 'qrv_' || q."id" || '_1', q."id", 1, q."text", q."hint", q."tags", q."difficulty", q."type"
FROM "Question" q
ON CONFLICT ("questionId", "revision") DO NOTHING;

-- Revisions can never be forgotten by a code path: the database records one whenever a question is created or its
-- content (text, hint, tags, difficulty, type) changes. Question.text and friends remain the current projection, so
-- every existing reader is unchanged, and the latest revision always equals the current content.
CREATE FUNCTION "question_revision_sync"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest RECORD;
  next_rev integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "QuestionRevision" ("id", "questionId", "revision", "text", "hint", "tags", "difficulty", "type")
    VALUES ('qrv_' || NEW."id" || '_1', NEW."id", 1, NEW."text", NEW."hint", NEW."tags", NEW."difficulty", NEW."type");
    RETURN NULL;
  END IF;
  SELECT * INTO latest FROM "QuestionRevision" WHERE "questionId" = NEW."id" ORDER BY "revision" DESC LIMIT 1;
  IF latest IS NULL
     OR latest."text" IS DISTINCT FROM NEW."text"
     OR latest."hint" IS DISTINCT FROM NEW."hint"
     OR latest."tags" IS DISTINCT FROM NEW."tags"
     OR latest."difficulty" IS DISTINCT FROM NEW."difficulty"
     OR latest."type" IS DISTINCT FROM NEW."type" THEN
    next_rev := COALESCE(latest."revision", 0) + 1;
    INSERT INTO "QuestionRevision" ("id", "questionId", "revision", "text", "hint", "tags", "difficulty", "type")
    VALUES ('qrv_' || NEW."id" || '_' || next_rev, NEW."id", next_rev, NEW."text", NEW."hint", NEW."tags", NEW."difficulty", NEW."type");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Question_revision_sync" AFTER INSERT OR UPDATE OF "text", "hint", "tags", "difficulty", "type" ON "Question"
  FOR EACH ROW EXECUTE FUNCTION "question_revision_sync"();

-- The pull feed starts complete: every existing attempt is announced once, oldest first.
INSERT INTO "SyncChange" ("learnerId", "entityType", "entityId")
SELECT a."learnerId", 'attempt', a."id" FROM "Attempt" a ORDER BY a."occurredAt", a."id";

INSERT INTO "SyncEpoch" ("id", "epoch") VALUES (1, 1) ON CONFLICT ("id") DO NOTHING;

-- ============================================================================================================
-- Privileges. (Skipped where the role does not exist.)
--  - the runtime role never edits a revision or a deletion receipt;
--  - SyncChange is the first table with a sequence-backed id, and default privileges do not cover sequences, so the
--    runtime role is granted the one sequence it needs. Without this every attempt write would fail at the feed insert.
-- ============================================================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iprep_app') THEN
    -- Revisions are only ever inserted (by the trigger) and removed by the FK cascade, which runs as the table owner.
    REVOKE UPDATE, DELETE, TRUNCATE ON "QuestionRevision" FROM "iprep_app";
    -- The feed and the diagnostic log are append-only for the runtime role; retention is an operator concern.
    REVOKE UPDATE, DELETE, TRUNCATE ON "SyncChange", "SyncEventLog" FROM "iprep_app";
    -- The sync epoch is bumped only by an operator (scripts/sync-epoch.ts, owner credential); the runtime role reads it.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "SyncEpoch" FROM "iprep_app";
    -- Receipts are written only by the owner-level purge; the runtime role may not write or change them at all.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "AccountDeletionReceipt" FROM "iprep_app";
    GRANT USAGE, SELECT ON SEQUENCE "SyncChange_id_seq" TO "iprep_app";
  END IF;
END $$;
