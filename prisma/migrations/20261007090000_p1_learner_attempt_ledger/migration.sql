-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptSurface" AS ENUM ('WRITTEN_TO_SPOKEN', 'LIVE_SPOKEN', 'PODCAST_RETRIEVAL', 'PODCAST_LISTEN', 'CHALLENGE', 'INTERVIEW_SIMULATION', 'TYPED_RETRIEVAL');

-- CreateEnum
CREATE TYPE "ResponseMode" AS ENUM ('SPOKEN', 'TYPED', 'NONE');

-- CreateEnum
CREATE TYPE "EvaluatorKind" AS ENUM ('AI_RUBRIC', 'DETERMINISTIC', 'HUMAN', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MeasurementDimension" AS ENUM ('RECALL', 'EXPLANATION', 'APPLICATION', 'DELIVERY', 'DISCRIMINATION', 'EXPOSURE');

-- AlterTable
-- Added nullable so existing rows can be bound by the backfill below, then made NOT NULL.
ALTER TABLE "MachinePrincipal" ADD COLUMN     "learnerId" TEXT;

-- AlterTable
ALTER TABLE "SessionItem" ADD COLUMN     "attemptId" TEXT;

-- CreateTable
CREATE TABLE "Learner" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "goalId" TEXT,
    "surface" "AttemptSurface" NOT NULL,
    "responseMode" "ResponseMode" NOT NULL,
    "questionId" TEXT,
    "promptSnapshot" TEXT NOT NULL,
    "questionType" TEXT,
    "tagsSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bankId" TEXT,
    "sessionId" TEXT,
    "hintUsed" BOOLEAN,
    "actorPrincipalId" TEXT,
    "source" TEXT NOT NULL,
    "legacyRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptEvidence" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "responseText" TEXT,
    "transcript" TEXT,
    "audioRef" TEXT,
    "transcriber" TEXT,
    "words" INTEGER,
    "wpm" INTEGER,
    "fillerCount" INTEGER,
    "fillerRate" DOUBLE PRECISION,
    "longPauses" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptEvaluation" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" "EvaluatorKind" NOT NULL,
    "status" "EvaluationStatus" NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "rubricVersion" TEXT,
    "promptVersion" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "failureReason" TEXT,
    "questionAnswered" BOOLEAN,
    "feedback" JSONB,
    "dimensionMap" TEXT,
    "evaluatedText" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyRef" TEXT,

    CONSTRAINT "AttemptEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptMeasurement" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "dimension" "MeasurementDimension",
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "scaleMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scaleMax" DOUBLE PRECISION NOT NULL DEFAULT 10,

    CONSTRAINT "AttemptMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Learner_userId_key" ON "Learner"("userId");

-- CreateIndex
CREATE INDEX "Goal_learnerId_status_idx" ON "Goal"("learnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_legacyRef_key" ON "Attempt"("legacyRef");

-- CreateIndex
CREATE INDEX "Attempt_learnerId_occurredAt_idx" ON "Attempt"("learnerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Attempt_questionId_idx" ON "Attempt"("questionId");

-- CreateIndex
CREATE INDEX "Attempt_sessionId_idx" ON "Attempt"("sessionId");

-- CreateIndex
CREATE INDEX "Attempt_goalId_idx" ON "Attempt"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvidence_attemptId_key" ON "AttemptEvidence"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvaluation_legacyRef_key" ON "AttemptEvaluation"("legacyRef");

-- CreateIndex
CREATE INDEX "AttemptEvaluation_attemptId_recordedAt_idx" ON "AttemptEvaluation"("attemptId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvaluation_id_attemptId_key" ON "AttemptEvaluation"("id", "attemptId");

-- CreateIndex
CREATE INDEX "AttemptMeasurement_attemptId_idx" ON "AttemptMeasurement"("attemptId");

-- CreateIndex
CREATE INDEX "AttemptMeasurement_dimension_idx" ON "AttemptMeasurement"("dimension");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptMeasurement_evaluationId_metric_key" ON "AttemptMeasurement"("evaluationId", "metric");

-- CreateIndex
CREATE INDEX "MachinePrincipal_learnerId_idx" ON "MachinePrincipal"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionItem_attemptId_key" ON "SessionItem"("attemptId");

-- AddForeignKey
ALTER TABLE "SessionItem" ADD CONSTRAINT "SessionItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePrincipal" ADD CONSTRAINT "MachinePrincipal_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_actorPrincipalId_fkey" FOREIGN KEY ("actorPrincipalId") REFERENCES "MachinePrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptEvidence" ADD CONSTRAINT "AttemptEvidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptEvaluation" ADD CONSTRAINT "AttemptEvaluation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptMeasurement" ADD CONSTRAINT "AttemptMeasurement_evaluationId_attemptId_fkey" FOREIGN KEY ("evaluationId", "attemptId") REFERENCES "AttemptEvaluation"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptMeasurement" ADD CONSTRAINT "AttemptMeasurement_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================================================
-- Invariants (database-level, so no code path can bypass them)
-- ============================================================================================================

-- Exposure-only attempts (listening) produce nothing; every other attempt produces a response.
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_exposure_has_no_response_chk"
  CHECK (("surface" = 'PODCAST_LISTEN') = ("responseMode" = 'NONE'));

ALTER TABLE "AttemptMeasurement" ADD CONSTRAINT "AttemptMeasurement_value_in_scale_chk"
  CHECK ("scaleMax" > "scaleMin" AND "value" >= "scaleMin" AND "value" <= "scaleMax");

-- The ledger is append-only. UPDATE and DELETE are refused unless a maintenance session explicitly opts in with
--   SET iprep.ledger_maintenance = 'on';
-- The one exception is nulling an Attempt's reference columns, which is what ON DELETE SET NULL does when a
-- question, bank, session, goal or principal is deleted: the attempt must outlive them.
CREATE FUNCTION "ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('iprep.ledger_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only: % refused (maintenance sessions set iprep.ledger_maintenance = on)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION "attempt_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER "Attempt_append_only" BEFORE UPDATE OR DELETE ON "Attempt"
  FOR EACH ROW EXECUTE FUNCTION "attempt_append_only"();
CREATE TRIGGER "AttemptEvidence_append_only" BEFORE UPDATE OR DELETE ON "AttemptEvidence"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
CREATE TRIGGER "AttemptEvaluation_append_only" BEFORE UPDATE OR DELETE ON "AttemptEvaluation"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
CREATE TRIGGER "AttemptMeasurement_append_only" BEFORE UPDATE OR DELETE ON "AttemptMeasurement"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();

-- Listening is exposure. A listen-only attempt can only ever carry EXPOSURE measurements, and a measurement can
-- only hang off an evaluation that actually completed (a FAILED or SKIPPED evaluation has no scores).
CREATE FUNCTION "attempt_measurement_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt_surface text;
  eval_status text;
BEGIN
  SELECT "surface"::text INTO attempt_surface FROM "Attempt" WHERE "id" = NEW."attemptId";
  IF attempt_surface = 'PODCAST_LISTEN' AND NEW."dimension" IS DISTINCT FROM 'EXPOSURE' THEN
    RAISE EXCEPTION 'A listen-only attempt can only carry EXPOSURE measurements (got %)', COALESCE(NEW."dimension"::text, 'no dimension')
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "status"::text INTO eval_status FROM "AttemptEvaluation" WHERE "id" = NEW."evaluationId";
  IF eval_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'Measurements can only belong to a COMPLETED evaluation (evaluation is %)', eval_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AttemptMeasurement_rules" BEFORE INSERT ON "AttemptMeasurement"
  FOR EACH ROW EXECUTE FUNCTION "attempt_measurement_rules"();

-- ============================================================================================================
-- Backfill. Deterministic ids (prefix + legacy id) make every statement idempotent and every imported row
-- recognisable. Nothing is invented: unknown values stay NULL, rows with no owner are not imported.
-- ============================================================================================================

-- One learner per existing user.
INSERT INTO "Learner" ("id", "userId", "createdAt")
SELECT 'lrn_' || u."id", u."id", u."createdAt" FROM "User" u
ON CONFLICT ("userId") DO NOTHING;

-- Machine principals act on behalf of their user's learner. They do not become learners.
UPDATE "MachinePrincipal" m SET "learnerId" = l."id"
FROM "Learner" l WHERE l."userId" = m."userId" AND m."learnerId" IS NULL;
-- Every principal is now bound to exactly one learner. There is no fallback through its user.
ALTER TABLE "MachinePrincipal" ALTER COLUMN "learnerId" SET NOT NULL;

-- Practice answers that belong to a learner. SessionItem has no owner of its own: the learner is the session's
-- owner. Items in sessions with no owner cannot be attributed to anyone and are intentionally not imported.
INSERT INTO "Attempt" ("id", "learnerId", "surface", "responseMode", "questionId", "promptSnapshot", "questionType",
                       "tagsSnapshot", "bankId", "sessionId", "source", "legacyRef", "occurredAt")
SELECT 'att_' || si."id", l."id", 'WRITTEN_TO_SPOKEN', 'SPOKEN', si."questionId", q."text", q."type"::text,
       q."tags", q."bankId", si."sessionId", 'legacy-backfill', 'SessionItem:' || si."id", si."createdAt"
FROM "SessionItem" si
JOIN "Session" s ON s."id" = si."sessionId"
JOIN "Learner" l ON l."userId" = s."userId"
JOIN "Question" q ON q."id" = si."questionId"
ON CONFLICT ("legacyRef") DO NOTHING;

INSERT INTO "AttemptEvidence" ("id", "attemptId", "transcript", "audioRef", "words", "wpm", "fillerCount", "fillerRate", "longPauses")
SELECT 'evi_' || si."id", 'att_' || si."id", si."transcript", si."audioUrl", si."words", si."wpm", si."fillerCount",
       si."fillerRate", si."longPauses"
FROM "SessionItem" si
WHERE EXISTS (SELECT 1 FROM "Attempt" a WHERE a."id" = 'att_' || si."id")
ON CONFLICT ("attemptId") DO NOTHING;

-- Content evaluation. When the stored feedback is one of the application's own failure messages, the numbers,
-- the answered flag and the feedback on the row were canned fallback output, not an assessment. The evaluation is
-- recorded as FAILED carrying only the failure message: no measurements, no feedback, no answered flag.
INSERT INTO "AttemptEvaluation" ("id", "attemptId", "kind", "status", "evaluatorVersion", "failureReason",
                                 "questionAnswered", "feedback", "dimensionMap", "legacyRef")
SELECT 'evl_' || si."id", 'att_' || si."id", 'LEGACY_IMPORT',
       CASE WHEN si."aiFeedback" ~ '^(AI analysis temporarily unavailable|AI analysis error|Could not analyze response|AI analysis timed out|Network error during AI analysis)'
            THEN 'FAILED'::"EvaluationStatus" ELSE 'COMPLETED'::"EvaluationStatus" END,
       'legacy-unversioned',
       CASE WHEN si."aiFeedback" ~ '^(AI analysis temporarily unavailable|AI analysis error|Could not analyze response|AI analysis timed out|Network error during AI analysis)'
            THEN 'legacy fallback stored as scores: ' || left(split_part(si."aiFeedback", ' | ', 1), 200) END,
       CASE WHEN si."aiFeedback" ~ '^(AI analysis temporarily unavailable|AI analysis error|Could not analyze response|AI analysis timed out|Network error during AI analysis)' THEN NULL ELSE si."questionAnswered" END,
       CASE WHEN si."aiFeedback" ~ '^(AI analysis temporarily unavailable|AI analysis error|Could not analyze response|AI analysis timed out|Network error during AI analysis)' THEN NULL
            ELSE jsonb_build_object('whatWasRight', si."whatWasRight", 'whatWasWrong', si."whatWasWrong",
                                    'betterWording', si."betterWording", 'dontForget', si."dontForget", 'text', si."aiFeedback") END,
       'dimensions@1',
       'SessionItem:' || si."id"
FROM "SessionItem" si
WHERE EXISTS (SELECT 1 FROM "Attempt" a WHERE a."id" = 'att_' || si."id")
  AND (si."aiFeedback" IS NOT NULL OR si."answerQuality" IS NOT NULL OR si."starScore" IS NOT NULL
       OR si."impactScore" IS NOT NULL OR si."clarityScore" IS NOT NULL OR si."technicalAccuracy" IS NOT NULL
       OR si."terminologyUsage" IS NOT NULL)
ON CONFLICT ("legacyRef") DO NOTHING;

-- Delivery heuristics (computed from the transcript, valid even when the AI step failed) are a separate evaluation.
INSERT INTO "AttemptEvaluation" ("id", "attemptId", "kind", "status", "evaluatorVersion", "dimensionMap", "legacyRef")
SELECT 'evd_' || si."id", 'att_' || si."id", 'LEGACY_IMPORT', 'COMPLETED', 'legacy-unversioned', 'dimensions@1',
       'SessionItem:' || si."id" || ':delivery'
FROM "SessionItem" si
WHERE EXISTS (SELECT 1 FROM "Attempt" a WHERE a."id" = 'att_' || si."id")
  AND (si."confidenceScore" IS NOT NULL OR si."intonationScore" IS NOT NULL)
ON CONFLICT ("legacyRef") DO NOTHING;

-- Measurements. Dimension tags (dimensions@1): technicalAccuracy -> RECALL, clarityScore -> EXPLANATION,
-- confidence and intonation -> DELIVERY. Composite and rubric-specific numbers carry no dimension.
INSERT INTO "AttemptMeasurement" ("id", "evaluationId", "attemptId", "dimension", "metric", "value")
SELECT 'mea_' || si."id" || '_' || m.metric, m.eval_prefix || si."id", 'att_' || si."id", m.dimension::"MeasurementDimension", m.metric, m.value
FROM "SessionItem" si
CROSS JOIN LATERAL (VALUES
  ('evl_', 'answerQuality',     NULL,          si."answerQuality"),
  ('evl_', 'starScore',         NULL,          si."starScore"),
  ('evl_', 'impactScore',       NULL,          si."impactScore"),
  ('evl_', 'clarityScore',      'EXPLANATION', si."clarityScore"),
  ('evl_', 'technicalAccuracy', 'RECALL',      si."technicalAccuracy"),
  ('evl_', 'terminologyUsage',  NULL,          si."terminologyUsage"),
  ('evd_', 'confidenceScore',   'DELIVERY',    si."confidenceScore"),
  ('evd_', 'intonationScore',   'DELIVERY',    si."intonationScore")
) AS m(eval_prefix, metric, dimension, value)
JOIN "AttemptEvaluation" e ON e."id" = m.eval_prefix || si."id" AND e."status" = 'COMPLETED'
WHERE m.value IS NOT NULL
ON CONFLICT ("evaluationId", "metric") DO NOTHING;

-- Compatibility link, so the divergence check can pair every legacy row with its canonical attempt.
UPDATE "SessionItem" si SET "attemptId" = 'att_' || si."id"
WHERE si."attemptId" IS NULL AND EXISTS (SELECT 1 FROM "Attempt" a WHERE a."id" = 'att_' || si."id");

-- ============================================================================================================
-- Privileges. The application's runtime role only ever inserts ledger rows. (The foreign-key SET NULL actions
-- run as the table owner, so they do not need UPDATE.) Skipped where the role does not exist (local databases).
-- ============================================================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iprep_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "Attempt", "AttemptEvidence", "AttemptEvaluation", "AttemptMeasurement" FROM "iprep_app";
  END IF;
END $$;
