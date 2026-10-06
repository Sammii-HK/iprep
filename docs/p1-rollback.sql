-- Rollback for prisma/migrations/20261007090000_p1_learner_attempt_ledger. NOT part of the migration history and
-- never run by tooling; an operator runs it by hand with the OWNER (migration) role if P1 must be undone.
--
-- What it removes: the Learner, Goal and Attempt* tables (and every canonical row in them), the SessionItem.attemptId
-- and MachinePrincipal.learnerId columns, the ledger functions and enum types, and the migration's history row.
-- What it does not touch: every legacy table and row. While practice and quiz flows dual-write, the legacy tables
-- hold the same answers, so nothing a learner did is lost. Before running it, deploy the application version from
-- before P1 (or leave the current one running: it falls back to legacy-only writes and logs "Ledger write failed").
--
-- Dropping the ledger tables does not fire their append-only triggers (those guard rows, not DROP TABLE).
BEGIN;

ALTER TABLE "SessionItem" DROP COLUMN "attemptId";
ALTER TABLE "MachinePrincipal" DROP COLUMN "learnerId";

DROP TABLE "AttemptMeasurement";
DROP TABLE "AttemptEvaluation";
DROP TABLE "AttemptEvidence";
DROP TABLE "Attempt";
DROP TABLE "Goal";
DROP TABLE "Learner";

DROP FUNCTION "attempt_measurement_rules"();
DROP FUNCTION "attempt_append_only"();
DROP FUNCTION "ledger_append_only"();

DROP TYPE "MeasurementDimension";
DROP TYPE "EvaluationStatus";
DROP TYPE "EvaluatorKind";
DROP TYPE "ResponseMode";
DROP TYPE "AttemptSurface";
DROP TYPE "GoalStatus";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261007090000_p1_learner_attempt_ledger';

COMMIT;
