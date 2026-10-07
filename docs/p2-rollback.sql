-- Rollback for prisma/migrations/20261008090000_p2_native_sync. NOT part of the migration history and never run by
-- tooling; an operator runs it by hand with the OWNER role if P2 must be undone, BEFORE the P1 rollback if both are.
--
-- What it removes: native identity (AuthIdentity, Device, tokens, invites, link codes), the sync feed and logs, the
-- deletion receipts, question revisions and external keys, the P2 Attempt/Evidence columns, and the P2 triggers. It
-- restores the P1 append-only guard. Users created through Sign in with Apple stay as ordinary users (they hold
-- learners and attempts that P1 owns), but lose their Apple sign-in. Nothing in the P1 ledger is deleted.
-- Dropping columns and tables does not fire the append-only row triggers.
BEGIN;

DROP TRIGGER "Question_revision_sync" ON "Question";
DROP FUNCTION "question_revision_sync"();

ALTER TABLE "Attempt" DROP CONSTRAINT "Attempt_contentLinkage_chk";
ALTER TABLE "Attempt" DROP COLUMN "clientEventId", DROP COLUMN "payloadHash", DROP COLUMN "deviceId",
  DROP COLUMN "questionRevisionId", DROP COLUMN "occurredAtSkewMs", DROP COLUMN "occurredAtSuspect",
  DROP COLUMN "evaluationRequested", DROP COLUMN "contentLinkage", DROP COLUMN "clientRef";
ALTER TABLE "AttemptEvidence" DROP COLUMN "durationMs";
ALTER TABLE "Question" DROP COLUMN "externalKey", DROP COLUMN "archivedAt";
ALTER TABLE "QuestionBank" DROP COLUMN "externalKey", DROP COLUMN "archivedAt";
ALTER TABLE "User" DROP COLUMN "deletionRequestedAt", DROP COLUMN "purgeAfter";

DROP TABLE "NativeRefreshToken";
DROP TABLE "Device";
DROP TABLE "AuthIdentity";
DROP TABLE "AccountLinkCode";
DROP TABLE "NativeInvite";
DROP TABLE "SyncChange";
DROP TABLE "SyncEpoch";
DROP TABLE "SyncEventLog";
DROP TABLE "AccountDeletionReceipt";
DROP TABLE "QuestionRevision";
DROP FUNCTION "question_revision_immutable"();

-- The P1 version of the Attempt append-only guard.
CREATE OR REPLACE FUNCTION "attempt_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  refs text[] := ARRAY['goalId', 'questionId', 'bankId', 'sessionId', 'actorPrincipalId'];
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

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008090000_p2_native_sync';

COMMIT;
