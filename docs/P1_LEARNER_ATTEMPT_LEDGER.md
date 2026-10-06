# P1: learner identity and the canonical attempt ledger

> Listening is exposure. Retrieval is evidence. Performance is stronger evidence.
> The learner record should describe what the learner has demonstrated, not what content the product has shown them.

Status: implemented locally and rehearsed on Preview. **Not applied to Production.** See "Production cutover" for the
steps and the rollback.

## 1. Current to canonical mapping

| Question | Before P1 | Canonical now |
| --- | --- | --- |
| 1. What is a learner? | `User` (credentials, role, flags). Sessions and quizzes hang off `userId`; `SessionItem` has no owner of its own and reaches its learner only through `Session.userId`, which is nullable. | `Learner`, 1:1 with `User`, the stable owner of learning evidence. A machine principal acts on behalf of a learner and is recorded as the *actor*; it is never a learner. |
| 2. What is a question? | `Question` (text, hint, tags, difficulty, type) in a `QuestionBank`. Deleted with its bank. | Unchanged, and kept as its own stable identity (not collapsed into any concept). An attempt references it (`questionId`, cleared if the question is deleted) and keeps a snapshot of the prompt, type, tags and bank. |
| 3. What is an answer or attempt? | `SessionItem` (practice) and `QuizAttempt` (quizzes): two tables, different shapes, scores mixed with evidence. | `Attempt`: one fact about what a learner did, on any surface. Evidence and interpretation are separate tables. |
| 4. What are scores? | Columns on `SessionItem` / `QuizAttempt`. AI failure and "too brief" fallbacks were stored as real scores (answerQuality 4, or all 2s) and fed spaced repetition. | `AttemptMeasurement` rows inside a versioned `AttemptEvaluation`. A fallback is a `FAILED` or `SKIPPED` evaluation with **no** measurements. |
| 5. Audio and transcripts? | `SessionItem.audioUrl/transcript` plus delivery metrics; `QuizAttempt.answer/audioUrl/transcript`. | `AttemptEvidence`: transcript, typed response, audio reference (as recorded, uninterpreted), transcriber, words, wpm, fillers, long pauses. |
| 6. What is a session? | `Session` owned a list of `SessionItem`s (items deleted with their bank). | A grouping of attempts. It never owns them: deleting a session or a bank leaves the attempts in the ledger with the reference cleared. |
| 7. What is duplicated? | Score columns on two tables; `LearningSummary`, `UserLearningInsight`, `UserQuestionProgress` are derived state. | Legacy score columns are now a projection of the ledger (dual write, below). Derived tables are untouched and remain recomputable. |
| 8. What must be preserved? | Production: 3 users, 55 banks, 637 questions, 14 sessions (3 unowned), 342 session items, 0 quiz attempts. | All of it. Nothing legacy is changed or removed; see section 3. |

## 2. Schema

Additive only. Two nullable columns on existing tables, six new tables, six enums.

- `Learner(id, userId unique, createdAt)`: FK to `User` is `RESTRICT`.
- `Goal(id, learnerId, title, targetDate?, status ACTIVE|ACHIEVED|ARCHIVED)`: deliberately minimal, no UI or API yet.
  Historical attempts have `goalId NULL`. No goal is ever invented.
- `Attempt`: `learnerId`, `goalId?`, `surface`, `responseMode`, `questionId?`, `promptSnapshot`, `questionType?`,
  `tagsSnapshot`, `bankId?`, `sessionId?`, `hintUsed?`, `actorPrincipalId?`, `source`, `legacyRef? unique`,
  `occurredAt`, `recordedAt`.
  - `surface`: `WRITTEN_TO_SPOKEN`, `LIVE_SPOKEN`, `PODCAST_RETRIEVAL`, `PODCAST_LISTEN`, `CHALLENGE`,
    `INTERVIEW_SIMULATION`, `TYPED_RETRIEVAL`. `responseMode`: `SPOKEN`, `TYPED`, `NONE`.
  - Only `WRITTEN_TO_SPOKEN` and `TYPED_RETRIEVAL` are written today; the rest are accepted and tested so planned
    surfaces need no migration.
- `AttemptEvidence` (1:1): `responseText?`, `transcript?`, `audioRef?`, `transcriber?`, `words?`, `wpm?`,
  `fillerCount?`, `fillerRate?`, `longPauses?`. Facts only; every field nullable because absence is honest.
- `AttemptEvaluation` (many per attempt): `kind` (`AI_RUBRIC`, `DETERMINISTIC`, `HUMAN`, `LEGACY_IMPORT`), `status`
  (`COMPLETED`, `FAILED`, `SKIPPED`), `evaluatorVersion`, `rubricVersion?`, `promptVersion?`, `provider?`, `model?`,
  `failureReason?`, `questionAnswered?`, `feedback` (JSON), `dimensionMap?`, `evaluatedText?` (only when the evaluator
  saw something other than the recorded evidence, such as a corrected transcript), `evaluatedAt?`, `recordedAt`.
- `AttemptMeasurement`: `evaluationId`, `attemptId`, `dimension?`, `metric`, `value`, `scaleMin`, `scaleMax`. Unique per
  `(evaluationId, metric)`. A composite foreign key `(evaluationId, attemptId)` guarantees a measurement belongs to the
  same attempt as its evaluation.
- Compatibility columns: `SessionItem.attemptId` (nullable, unique, `SET NULL`) and `MachinePrincipal.learnerId`
  (nullable, `RESTRICT`).

### Measurement dimensions

`RECALL`, `EXPLANATION`, `APPLICATION`, `DELIVERY`, `DISCRIMINATION`, `EXPOSURE`. Measurements are sparse: a row exists
only for something that was measured, and `dimension` is NULL for numbers that do not honestly belong to one.
Tagging is versioned (`dimensions@1`) and kept on each evaluation:

| metric | dimension |
| --- | --- |
| `technicalAccuracy` | RECALL |
| `clarityScore` | EXPLANATION |
| `confidenceScore`, `intonationScore` | DELIVERY |
| `answerQuality`, `starScore`, `impactScore` (specificity), `terminologyUsage` | none (composite or rubric-specific) |

APPLICATION and DISCRIMINATION are reserved for surfaces that can actually measure them. **Exposure is not recall**:
a `PODCAST_LISTEN` attempt has no response (`responseMode NONE`, enforced by a CHECK) and the database refuses any
measurement on it other than `EXPOSURE`.

### Database-level invariants

All in the migration, so no code path can bypass them:

- The four ledger tables are **append-only**. Row triggers refuse `UPDATE` and `DELETE` unless the session sets
  `iprep.ledger_maintenance = 'on'` (a deliberate maintenance action, inside its own transaction). The one allowed
  change is clearing an `Attempt` reference column (`questionId`, `bankId`, `sessionId`, `goalId`,
  `actorPrincipalId`), which is exactly what `ON DELETE SET NULL` does; a reference can never be repointed.
- The runtime role `iprep_app` has `UPDATE`, `DELETE`, `TRUNCATE` revoked on the four ledger tables (it only inserts
  and reads). Foreign-key actions run as the table owner, so deleting a question or session still works.
- A `FAILED` or `SKIPPED` evaluation cannot carry measurements. Values must sit inside their scale.
- `learnerId` is `RESTRICT` everywhere: a user or learner with evidence cannot be deleted.

### Evaluator, rubric and model versioning (replay)

Every evaluation records evaluator, rubric and prompt versions, provider, model, dimension-map version and time.
`SPOKEN_ANSWER_EVALUATOR` in `lib/attempts.ts` holds the current labels; `__tests__/lib/evaluator-version-guard.test.ts`
pins a hash of the prompt text to `promptVersion`, so editing the prompt fails the test until the version is bumped.
Re-evaluation (the reanalyze route) **appends** a new evaluation; "current" is the latest `COMPLETED` evaluation per
kind (`latestCompleted`).

## 3. Migration

`20261007090000_p1_learner_attempt_ledger`: structure, invariants, backfill and privilege hardening in one file.
Deterministic ids (`lrn_`, `att_`, `evi_`, `evl_`, `evd_`, `mea_` + the legacy id) make every backfill statement
idempotent (tested: re-running changes nothing) and every imported row recognisable.

### Historical mapping

- **Learner**: one per `User`, `createdAt` copied from the user.
- **Machine principals**: `learnerId` set to their user's learner.
- **Attempt** from each `SessionItem` whose session has an owner: `WRITTEN_TO_SPOKEN`/`SPOKEN`, `source =
  legacy-backfill`, `legacyRef = SessionItem:<id>`, `occurredAt = SessionItem.createdAt`, prompt snapshot from the
  question, `goalId NULL`. `SessionItem.attemptId` is set to link them.
- **Evidence**: transcript, audio reference, words, wpm, fillers, long pauses, copied exactly.
- **Evaluation, content**: one `LEGACY_IMPORT` per item (`evaluatorVersion legacy-unversioned`). Feedback arrays and
  text go in `feedback`. If the stored feedback is one of the application's own failure messages the row is `FAILED`
  with no measurements (the numbers on it were canned, not an assessment).
- **Evaluation, delivery**: a separate `LEGACY_IMPORT` carrying confidence and intonation, which are valid even when
  the AI step failed.
- **Measurements**: one per non-null score column, dimension per the table above.

### Row counts (Production, read-only inspection; identical on Preview after rehearsal)

| | Before | After |
| --- | --- | --- |
| Users / learners | 3 | 3 learners |
| Sessions | 14 (3 unowned) | unchanged |
| SessionItems | 342 (39 in unowned sessions) | unchanged; 303 linked to an attempt |
| Attempts, evidence | none | 303, 303 |
| Evaluations | none | 606 (280 content COMPLETED, 23 content FAILED, 303 delivery) |
| Measurements | none | 2286 (1120 untagged, 606 DELIVERY, 280 EXPLANATION, 280 RECALL) |
| QuizAttempts | 0 | 0 (nothing to import) |
| Machine principals | 4 (all on the admin user) | 4, each bound to that user's learner |

### Unmappable and intentional nulls

- **39 session items in 3 unowned sessions** are not imported: there is no learner to attribute them to, and none is
  invented. They stay in the legacy table, untouched. (5 of the 28 stored fallbacks in the whole table are among them;
  23 are in owned sessions and become `FAILED` evaluations.)
- Intentional NULLs on every historical row: `goalId`, evaluation `rubricVersion`, `promptVersion`, `provider`,
  `model`, `evaluatedAt`, evidence `transcriber`, `actorPrincipalId`. They were never recorded. `recordedAt` is the
  import time.
- A score that was never recorded has no measurement row (for example `answerQuality` on the oldest rows). Nothing is
  zero-filled.
- 9 of 342 rows have no `questionAnswered`; it stays NULL.
- The audio reference is copied as stored. It is not interpreted or normalised.

## 4. Attempt pipeline and compatibility

`lib/learner.ts` (identity), `lib/attempts.ts` (pure builders, validation, writers), `lib/attempt-compat.ts` (the
compatibility layer the routes call).

- **Practice** (`POST /api/practice`): one transaction ensures the learner, records the attempt (evidence, AI
  evaluation, delivery evaluation, measurements) and creates the legacy `SessionItem` carrying `attemptId`. Response
  shape is unchanged, so no UI change.
- **Quizzes** (`POST /api/quizzes/attempt`): same, paired through `legacyRef = QuizAttempt:<id>`.
- **Re-analysis** (`POST /api/practice/reanalyze`): appends a new evaluation (and `evaluatedText` for the corrected
  transcript); evidence and earlier evaluations are never edited.
- **Registration** creates the learner with the account; `ensureLearner` creates one lazily for any user without.
- **Failure provenance**: the practice and quiz routes now tell a real evaluation from a fallback. A fallback is
  recorded as `FAILED` or `SKIPPED` and is **not** fed to spaced repetition any more (previously a canned 4 was).
  The learner still sees the same fallback text and the legacy columns still hold the same canned numbers for the UI.

### Canonical source, divergence and removal

- **Canonical source**: the Attempt ledger, for everything recorded from the P1 deploy. Legacy score columns are a
  projection kept for the current UI; nothing reads the ledger for display yet.
- **Atomic**: attempt and legacy row are written in one transaction, so they cannot disagree. If the ledger write
  fails (including the new tables not existing yet during a deploy) the answer is saved legacy-only with `attemptId
  NULL` and the failure is logged. The learner never loses an answer.
- **Divergence detection**: `pnpm ledger:check --target <t> --env-file <runtime env>` (read-only) reports users with
  no learner, unbound or mismatched principals, owned legacy answers with no attempt, attempt/session-owner
  mismatches, legacy overall score differing from the latest completed evaluation, and quiz answers with no attempt.
  Exit 1 on any divergence.
- **Removal**: the dual write and the legacy score columns go once reads move to the ledger. That is later work, not
  P1, and needs its own migration (contract step).
- **Machine principals** are unchanged in what they may do. `requireAccess` now also returns the principal's
  `learnerId`; `resolveLearnerActor` gives `{ learnerId, actorPrincipalId }`.

## 5. Preview rehearsal (2026-10-07)

Applied with `pnpm db:deploy --target preview --env-file ~/.config/iprep/preview-migrate.env` (role
`preview_migrator`), which recorded the rehearsal receipt for this exact set of migrations. Verified as the runtime
role `iprep_app`: counts as in the table above; `UPDATE`/`DELETE` on ledger tables and `CREATE TABLE` denied; a full
attempt (evidence, two evaluations, four measurements) written and read back through the application code inside a
transaction that was then rolled back, leaving Preview untouched; `ledger:check` clean (7 of 7). The Production
numbers were predicted beforehand from a read-only query and matched Preview exactly (3 / 303 / 23 / 39). No
application deployment was made for the rehearsal (database only).

## 6. Tests

- `__tests__/lib/attempts.test.ts`, `learner.test.ts`, `attempt-compat.test.ts`, `evaluator-version-guard.test.ts`:
  surfaces and dimensions, exposure is not recall, sparse measurements, evaluator versions retained, fallbacks never
  stored as scores, learner mapping, machine principal acts as a learner but is not one, ledger-failure fallback.
- `__tests__/api/practice.test.ts`, `auth-boundary.test.ts`: the route hands the compatibility layer the right
  provenance (COMPLETED, FAILED, SKIPPED), failures do not move the review schedule, principals carry `learnerId`.
- `__tests__/db/ledger.integration.test.ts` (local Postgres, `pnpm test:db`): builds a Production-shaped pre-P1
  database, applies the migration and checks historical preservation, honest absence, idempotency, every invariant,
  the restricted role, the real practice write path, the divergence check, rollback, and migration-free builds.

## 7. Deferred (explicitly out of P1)

iOS sync and native persistence; FSRS; a Concept Map; the Today planner and readiness; responsive podcast and the
retrieval pause UI; live spoken overhaul; challenge framework and boss rounds; XP redesign; goals UI/API; reading the
ledger for display; extracting `AuthIdentity` from `User`; removing the legacy score columns; importing historical
`QuizAttempt` rows (none exist). Also noted: the reanalyze route still overwrites the legacy row with the fallback's
canned numbers when re-analysis fails (existing behaviour, left alone; the ledger records it as `FAILED`).

## 8. Production cutover (NOT performed)

Prerequisites: Sammii's explicit go-ahead; this branch merged through a PR (builds are expensive: one PR, one deploy).

1. Restore point: create a Neon branch from `main` (for example `pre-p1-cutover`); keep `pre-p0-cutover`.
2. Confirm the rehearsal receipt: `pnpm db:deploy --target production --env-file ~/.config/iprep/production-migrate.env`
   prints status only and lists the single pending migration.
3. Apply: the same command with `--confirm ep-dawn-sun-ahkhrdkl`. Migration first, then the application deploy
   (the new code also tolerates running before the migration: it falls back to legacy-only writes).
4. Verify with the runtime role (`production-runtime.env`): learners 3, attempts 303, evidence 303, evaluations 606 (23
   `FAILED`), measurements 2286, 39 unattributed items; `pnpm ledger:check --target production --env-file
   ~/.config/iprep/production-runtime.env` clean.
5. After the first real practice answer: confirm a new attempt with `source practice-api` and its `SessionItem.attemptId`.

Rollback: the migration is additive and the application is backwards compatible, so (a) redeploying the previous
application version is sufficient and loses nothing (old code ignores the new tables and columns); (b) to remove the
schema, run `docs/p1-rollback.sql` by hand with the owner role (tested: it returns the database to exactly the pre-P1
schema and leaves all legacy rows untouched); (c) for a worst case restore from the Neon restore branch. Canonical
rows written after cutover exist only in the ledger tables, but every practice and quiz answer is also in its legacy
table while the dual write runs, so rolling back loses no learner data.
