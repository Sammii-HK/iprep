# P1: learner identity and the canonical attempt ledger

> Listening is exposure. Retrieval is evidence. Performance is stronger evidence.
> The learner record should describe what the learner has demonstrated, not what content the product has shown them.

Status: implemented, reviewed through this PR, and rehearsed on Preview. **Not applied to Production.** See "Production cutover" for the
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
  (**required**, `RESTRICT`: the migration binds every existing principal to its user's learner, then sets NOT NULL).

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

### Append-only lifecycle: what may change and why

| Table | Rule | Reason |
| --- | --- | --- |
| `Attempt` | immutable, except that a reference (`questionId`, `bankId`, `sessionId`, `goalId`, `actorPrincipalId`) may be **cleared**, never changed | the fact of what the learner did must not be rewritable; the clearing is what `ON DELETE SET NULL` needs so an attempt outlives its question or session |
| `AttemptEvidence` | immutable | what the learner produced is a fact. A corrected transcript is not an edit: it is recorded on the new evaluation as `evaluatedText` |
| `AttemptEvaluation` | immutable | interpretation is superseded by appending a newer evaluation, never edited. "Current" is the latest `COMPLETED` one per kind |
| `AttemptMeasurement` | immutable | a measurement belongs to one evaluation |

There is no operational state on any of these rows. In P1 every evaluation is written **after** the evaluator has
finished (`COMPLETED`, `FAILED` or `SKIPPED`), in the same transaction as the attempt, so a processing lifecycle does
not exist yet and the simple invariant is the right one. If asynchronous evaluation arrives later, the lifecycle
belongs on `AttemptEvaluation` only: add a `PENDING` status in its own migration and relax that one trigger to permit
exactly `PENDING -> COMPLETED|FAILED` (status, failure reason, feedback, evaluated time and measurements being
filled in), nothing else, and never a transition out of a terminal status. Re-evaluation would still append. Evidence
and attempts stay immutable, so nothing about that future needs the other triggers to loosen.

### Context rules confirmed

- **Goal** is context, not content: nothing in P1 reads it, and a goal being created or marked achieved creates no
  attempt, evidence or measurement (tested). Historical attempts have `goalId NULL`; current attempts have none
  unless one is genuinely known (none are written with one today). A goal is not a `QuestionBank` and completing
  content is never treated as demonstrated learning.
- **Exposure** cannot reach recall. At the database: a listen-only attempt must have `responseMode NONE` (and nothing
  else may), and its only permitted measurements are `EXPOSURE`. In code: no scored metric maps to `EXPOSURE`
  (`METRIC_DIMENSIONS`), `validateAttemptInput` and `appendEvaluation` refuse anything else on a listen-only attempt,
  and `EVIDENCE_DIMENSIONS` lists the dimensions that count as demonstrated, with `EXPOSURE` deliberately absent.
- **Machine principals** act *on behalf of* a learner: `MachinePrincipal.learnerId` is required and explicit. A
  principal is never a learner (no `Learner` row is keyed by one) and does not inherit one through its user or an
  admin role: `resolveLearnerActor` refuses a principal with no binding rather than falling back to its user's
  learner, and `requireAccess` still forces the role to `USER`. The P0 scope and audit boundary is unchanged.

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
  text go in `feedback`. If the stored feedback is one of the application's own failure messages, the stored numbers,
  the answered flag and the feedback were canned fallback output, not an assessment: the evaluation is `FAILED`,
  carries only the failure message in `failureReason`, and has **no** measurements, no `questionAnswered` and no
  feedback. The canned values stay in the legacy row (untouched) and nowhere in the ledger.
- **Evaluation, delivery**: a separate `LEGACY_IMPORT`, created only for rows that actually have a confidence or
  intonation score. They are computed from the transcript, so they stay valid even when the AI step failed.
- A row with evidence but no scores and no feedback gets **no** evaluation of that kind (tested with a fixture row).
- **Measurements**: one per non-null score column, dimension per the table above.

### Row counts and the 606 audit (Production predicted by read-only query; Preview measured after rehearsal, identical)

| | Before | After |
| --- | --- | --- |
| Users / learners | 3 | 3 learners |
| Sessions | 14 (3 unowned) | unchanged |
| SessionItems | 342 (39 in unowned sessions) | unchanged; 303 linked to an attempt, 39 untouched and unlinked |
| Attempts / evidence | none | 303 / 303 |
| Evaluations | none | **606** |
| Measurements | none | 2286 |
| QuizAttempts | 0 | 0 (nothing to import) |
| Machine principals | 4 (all on the admin user) | 4, each bound to that user's learner (Preview has none; the fixture test covers it) |

Why 606: 303 owned attempts, and **every** one of them has both kinds of evidence in its legacy row (AI feedback text
and confidence/intonation scores), so each gets two evaluations. This was checked, not assumed: zero content
evaluations exist without legacy content evidence, zero delivery evaluations exist without a legacy delivery score,
and zero rows are missing an evaluation they have evidence for.

| Evaluation | COMPLETED | FAILED | SKIPPED |
| --- | --- | --- | --- |
| Content (semantic/knowledge) | 280 | 23 | 0 |
| Delivery | 303 | 0 | 0 |
| **Total** | 583 | 23 | 0 |

| Measurements by dimension | Count |
| --- | --- |
| DELIVERY (confidence 303, intonation 303) | 606 |
| EXPLANATION (clarityScore) | 280 |
| RECALL (technicalAccuracy) | 280 |
| dimensionless (answerQuality, starScore, impactScore, terminologyUsage, 280 each) | 1120 |

The 23 `FAILED` content evaluations are the owned rows whose stored feedback was a fallback message. All 23 have a
failure reason, no measurements, no feedback and no answered flag (0 of 23 carry any canned field). The 5 other
fallback rows live in the 3 unowned sessions and are left untouched with the rest of the unowned legacy data. No
semantic measurement was generated from a canned value.

### Unmappable and intentional nulls

- **39 session items in 3 unowned sessions** are not imported: there is no learner to attribute them to. No learner
  is manufactured, none is attached to the admin, no goal is invented, nothing is deleted and no canonical evidence is
  created for them. They stay legacy records until something identifies their learner. (5 of the 28 stored fallbacks in the whole table are among them;
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
- **Failure provenance**: the practice and quiz routes tell a real evaluation from a fallback. A fallback is
  recorded as `FAILED` or `SKIPPED` with no measurements and does **not** feed spaced repetition (previously a canned
  4 did).

### Canonical-write invariant (decision)

From the P1 deploy onward **a successful learning attempt always has canonical evidence.** The attempt, its
evidence, its evaluations and measurements, and the legacy projection row are written in **one database
transaction**. If any part fails (including the new tables not existing yet) the request fails, the learner sees the
normal "failed to save, please try again" error, and **neither representation commits**. There is no legacy-only
fallback, so there is no untracked split-brain state and nothing for `ledger:check` to recover. An earlier draft
degraded to legacy-only and logged; that was removed.

The cost is that a ledger outage rejects a recording that already paid for transcription and analysis. That is judged
acceptable for a database that is the single store for both representations (a ledger failure is a database failure),
and it keeps the invariant simple. If a durable recovery path is ever needed it should be an explicit outbox
(persist the raw recording and transcript first, reconcile asynchronously, visible and counted), not a silent split.
Because failure now fails requests, **the migration must be applied before the application code is deployed.**

### Re-analysis and failed evaluation (exact compatibility behaviour)

`POST /api/practice/reanalyze`, in one transaction: append a new evaluation to the attempt, and update the legacy row
only if the evaluator completed.

- **Evaluator succeeds**: new `COMPLETED` evaluation appended (with the corrected transcript as `evaluatedText`); the
  legacy row is updated with the new scores and transcript as before.
- **Evaluator fails** (every retry exhausted): a `FAILED` evaluation with the reason and corrected text is appended, no
  measurements; the **legacy row is not touched at all**, so the learner keeps their previous legitimate analysis and
  no canned numbers are written or shown; the route responds `502` ("could not re-analyse, your previous analysis is
  unchanged, please try again"). Previously it overwrote the row with canned 4s and returned them.
- An answer with no canonical attempt cannot be re-analysed (cannot happen for owned answers after the migration).

### Remaining compatibility caveat (not changed in P1)

The *initial* practice and spoken-quiz flows still show the learner fallback text and write the same canned numbers to
the legacy columns when the evaluator fails (the legacy UI expects numbers there). The ledger records those as
`FAILED` with no scores and spaced repetition ignores them, so canned numbers never become evidence; only the legacy
projection carries them. Removing that needs the UI to render "analysis unavailable" (compatibility exit, below).

### Canonical source, divergence and removal

- **Canonical source**: the Attempt ledger, for everything recorded from the P1 deploy. Legacy score columns are a
  projection kept for the current UI; nothing reads the ledger for display yet.
- **Divergence detection**: `pnpm ledger:check --target <t> --env-file <runtime env>` (read-only) detects corruption
  and historical gaps; it is not a recovery mechanism for accepted writes. It reports users with
  no learner, unbound or mismatched principals, owned legacy answers with no attempt, attempt/session-owner
  mismatches, legacy overall score differing from the latest completed evaluation, and quiz answers with no attempt.
  Exit 1 on any divergence.
- **Machine principals** are unchanged in what they may do. `requireAccess` now also returns the principal's
  `learnerId`; `resolveLearnerActor` gives `{ learnerId, actorPrincipalId }`.

## 5. Preview rehearsal

The migration changed during review (required principal binding; failed rows carry failure metadata only), so Preview
was **reset cleanly**: the tested `docs/p1-rollback.sql` was run with the Preview owner role in one transaction, then
the revised migration was applied with `pnpm db:deploy --target preview --env-file ~/.config/iprep/preview-migrate.env`
(a fresh rehearsal receipt for exactly this set of migrations). No corrective migration was stacked on Preview.
Verified as the runtime role `iprep_app`: every number in section 3; `UPDATE`/`DELETE`/`TRUNCATE` on ledger tables and
`CREATE TABLE` denied; `ledger:check` clean (7 of 7). An empty-database migration and a schema-drift check
(`prisma migrate diff --exit-code`) were also clean. The Production numbers were predicted from a read-only query
beforehand and match Preview exactly. No application deployment was made for the rehearsal.

## 6. Tests

- `__tests__/lib/attempts.test.ts`, `learner.test.ts`, `attempt-compat.test.ts`, `evaluator-version-guard.test.ts`:
  surfaces and dimensions, exposure is not recall, sparse measurements, evaluator versions retained, fallbacks never
  stored as scores, learner mapping, machine principal acts on behalf of a learner but is not one and never inherits one, atomic failure (no legacy-only fallback), re-analysis failure leaves the legacy row untouched.
- `__tests__/api/practice.test.ts`, `auth-boundary.test.ts`: the route hands the compatibility layer the right
  provenance (COMPLETED, FAILED, SKIPPED), failures do not move the review schedule, principals carry `learnerId`.
- `__tests__/db/ledger.integration.test.ts` (local Postgres, `pnpm test:db`): builds a Production-shaped pre-P1
  database, applies the migration and checks historical preservation, honest absence, idempotency, every invariant,
  the restricted role, the real practice write path, the divergence check, rollback, and migration-free builds.

## 7. Deferred (explicitly out of P1)

iOS sync and native persistence; FSRS; a Concept Map; the Today planner and readiness; responsive podcast and the
retrieval pause UI; live spoken overhaul; challenge framework and boss rounds; XP redesign; goals UI/API; reading the
ledger for display; extracting `AuthIdentity` from `User`; removing the legacy score columns; importing historical
`QuizAttempt` rows (none exist).

## 8. Compatibility exit plan (canonical ledger + legacy projection -> canonical ledger only)

Not performed in P1. Today the ledger is canonical and the legacy columns are a projection the UI still reads.

**Routes that still dual-write** (ledger and legacy in one transaction): `POST /api/practice` (`SessionItem`),
`POST /api/quizzes/attempt` (`QuizAttempt`), `POST /api/practice/reanalyze` (updates `SessionItem` on success).

**Reads that still use legacy score columns:** `GET /api/sessions/[id]` and the session, mock and pitch practice pages
that render it; `GET /api/analytics/summary`; `GET /api/reports`; `lib/learning-analytics.ts` (session summaries and
`UserLearningInsight`, built on session completion); `lib/study-tracker.ts` (`UserQuestionProgress.lastScore` is fed the
overall score at write time). The MCP progress and review tools read the derived tables, so they move with those.
`DELETE /api/banks/[id]` deletes `SessionItem`s, which is safe: attempts survive it.

**Phases:**
1. *Read migration* (a later phase, with the Today/readiness work): serve sessions, analytics, reports and learning
   summaries from `Attempt` + latest completed evaluations (`latestCompleted`), including "analysis unavailable" for
   `FAILED` evaluations so the canned-number projection is no longer needed. Derived tables are rebuilt from the ledger.
2. *Stop writing the projection*: remove the legacy score writes from the three routes. `SessionItem` keeps only what
   the session UI still needs (or is replaced by an attempt list).
3. *Contract migration*: drop `SessionItem` score/feedback columns and `attemptId`, and `QuizAttempt` score columns.

**Condition to remove the legacy columns and write path:** `ledger:check` clean for a full release cycle, every read
above served from the ledger and verified against the legacy values on Preview, no code reading the legacy columns
(a grep gate in CI), and a restore point taken first. Historical unowned `SessionItem`s are the only legacy rows with no
canonical counterpart; they are either attributed (if a learner is ever identified) or archived deliberately before
the legacy table is dropped.

## 9. Production cutover (NOT performed)

Prerequisites: Sammii's explicit go-ahead; this branch merged through a PR (builds are expensive: one PR, one deploy).

1. Restore point: create a Neon branch from `main` (for example `pre-p1-cutover`); keep `pre-p0-cutover`.
2. Confirm the rehearsal receipt: `pnpm db:deploy --target production --env-file ~/.config/iprep/production-migrate.env`
   prints status only and lists the single pending migration.
3. Apply: the same command with `--confirm ep-dawn-sun-ahkhrdkl`. Migration first, then the application deploy
   (required, not optional: code that writes the ledger fails requests if the tables do not exist).
4. Verify with the runtime role (`production-runtime.env`): learners 3, attempts 303, evidence 303, evaluations 606 (23
   `FAILED`, all with failure metadata only), measurements 2286, 39 unattributed items, 4 principals bound to the admin
   user's learner; `pnpm ledger:check --target production --env-file
   ~/.config/iprep/production-runtime.env` clean.
5. After the first real practice answer: confirm a new attempt with `source practice-api` and its `SessionItem.attemptId`.

Rollback: the migration is additive and the application is backwards compatible, so (a) redeploying the previous
application version is sufficient and loses nothing (old code ignores the new tables and columns); (b) to remove the
schema, run `docs/p1-rollback.sql` by hand with the owner role (tested: it returns the database to exactly the pre-P1
schema and leaves all legacy rows untouched); (c) for a worst case restore from the Neon restore branch. Canonical
rows written after cutover exist only in the ledger tables, but every practice and quiz answer is also in its legacy
table while the dual write runs, so rolling back loses no learner data. One operator caveat: after the migration the
principal script (`scripts/principals.ts`, already updated) is the only thing that creates principals and it binds a
learner; the previous version of that script would fail on the required column, which is the intended boundary.
