# iPrep vNext plan

Status: plan only. Nothing in this document has been implemented. Written 6 October 2026, after the audit (`iPrep-product-and-technical-audit.md`, with dossiers `web.md`, `native.md`, `audio.md`, `spoken.md`) and a re-check of the repos, branches and production on the same day.

The aim: iPrep stops being a set of good features and becomes one learning system. Spoken retrieval stays the centre. Listening, quiet practice, scheduling, planning and the hosts all read from, and write to, the same record of what the learner has actually done.

Working rules for this plan:

- Reuse and consolidate. No parallel systems. Where something exists (SM-2, stage-1 FSRS, the stage-1 plan builder, `Interview`, the claims check, the rubric) it is either promoted into the shared system or retired with a migration.
- No flashcards. Reveal-before-attempt is not a learning mode here.
- No guilt mechanics. Rest is free. Nothing is lost by stopping.
- A failed AI call is never stored as a score.
- Listening is exposure. It never counts as mastery.
- The hosts never invent personal histories.
- Anything outward-facing or irreversible (production migrations, shared APIs, account merges) waits for an explicit yes.

---

## A. Current-state update (what changed since the audit)

Changes that materially alter the audit's conclusions:

1. **Preview and production share one database.** In Vercel, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and the `DATABASE_POSTGRES_*` variables each exist once, scoped to Production, Preview and Development together. The build runs `prisma migrate deploy`. So every pull request preview applies its migrations to the production database before anyone merges. PR #4's `Interview` table was created that way. It was additive, so it was harmless; a destructive or backfilling migration would not be. This is the highest-priority new fact and it sets the order of everything below.
2. **PR #4 is merged.** `Interview` (web), the Notion sync route and script, and the next-interview card are now on `main`. The audit tagged these UNMERGED. The Notion connection on the Mac mini is not yet live (needs the Interview Prep database shared with the integration, then `scripts/sync-notion-interviews.py --dry-run`).
3. **Legacy episodes are restored.** The 31 old generic and past-role episodes now live at `audio/study/legacy/<id>.mp3` on R2 and the manifest was rebuilt: 18 folders, 81 episodes, about 1.1 GB if everything were downloaded. The regression the audit recorded as a post-audit note is closed, pending PR #5 (script change only; the manifest itself is already live). The restored files are flat mp3s with no script, no timing and, in the older ones, an outro that mentions Lunary. They are not yet structured episodes (section J).
4. **Native stage 1 is built (branch `feat/learning-stage1`, not pushed).** An FSRS 4.5-style scheduler, a pure plan builder, a mistakes loop, a streak with one free rest day a week, a Today tab, a story deck, a boss-level readiness bar and one optional nudge. 27 unit tests pass and the Release build succeeds. It has not been seen running on the phone. Consequences for the audit:
   - The native scheduler count is now FSRS (stage 1) versus web SM-2: **two** schedulers, not three. `SpacedRepetitionService` is deleted.
   - Rich scheduler state lives in a local JSON file (`learning-state-v1.json`), not SwiftData, deliberately, to leave the CloudKit schema untouched. It is **not synced**. Only the existing `BankQuestion` due-date fields sync.
   - Review moved under "More" in the tab bar; the App Store screenshot test that taps Review will fail.
5. **`LearningKey` evaluated (section D.3).** It is a good bridge key and a bad identity.
6. **`/study` is live and used.** `Study` is a top-level nav item in the dashboard layout and `app/(dashboard)/study/[bankId]/page.tsx` implements reveal-on-tap flip cards with confidence buttons. It is device-local, never reaches the server, and is exactly the pattern to retire (section G.4).
7. **Voice mode is still unmerged and has never run with a real microphone** (`feat/voice-conversation`, 3 commits, 9eaf7ae).
8. **Still true from the audit, unchanged:** two separate products with two separate stores; no shared account or question identity; failed analysis stored as a real score on web; episodes know their bank, not their questions; Jess and Zac are two voice ids and a prompt.

Open security items (from the audit, not yet acted on): unauthenticated `GET /api/banks/[id]` and `/api/banks/[id]/audio`; unauthenticated `POST /api/quizzes/attempt`; `x-internal-key` maps to the admin user; credentials hard-coded in `generate_n8n_episodes.mjs` and some seed scripts.

---

## B. Product architecture and proposed names

Eight small systems, one shared record. Names are working names, plain on purpose.

| Name | What it is | Replaces / absorbs |
|---|---|---|
| **Goal** | Anything the learner is preparing for, with a date and a prep set. An interview is one kind of Goal. | `Interview` (kept as a Goal subtype), `User.interviewDate`, native onboarding date |
| **Ledger** | Append-only log of everything the learner did: attempts, listens, self-grades, challenge outcomes. The only source of truth for learner state. | `SessionItem`, `QuizAttempt`, `UserQuestionProgress` (as inputs), native `PracticeSession`, stage-1 review log |
| **Concept Map** | Concepts (topics, skills, technologies) with prerequisite and related links, and question links, each with provenance and confidence. | free-text `tags` and `category` strings |
| **Verdict** | The one evaluation contract: rubric, scale, honesty rules, engine and version, failure status. | web scorer, native heuristics, backend `/api/score`, voice scoring |
| **Recall** | The one scheduler: FSRS per question, with concept-level state derived from it. | web SM-2 (`lib/study-tracker.ts`), native FSRS draft |
| **Today** | The one planner: given state, goals, time and mode, returns an explainable plan. | stage-1 `PlanBuilder`, web "due queue", native random pick |
| **Script** | Structured episode: segments, speakers, timing, concept ids, interaction points. | flat `audio/study/<bankId>.mp3` + sidecar |
| **Hosts** | Persona definitions and grounded memory for Jess and Zac. | two voice ids and a prompt |

Flow of data, in one line: **practice, listening and challenges write events to the Ledger; Verdict decides what an attempt means; Recall and the Concept Map derive state from the Ledger; Today reads that state plus Goals and picks the next thing; Script and Hosts generate material for it.**

Everything above is derived from the Ledger except Goals, content (questions, concepts, scripts) and preferences. Derived state can always be rebuilt by replay. That is the single most important property for migration safety (section N).

---

## C. Learner-state model

### C.1 Unit of state

Two levels, both derived, never edited by hand:

- **Item state** per `(learner, question)`: FSRS stability, difficulty, last review, due date, lapse count, plus best and latest verdict.
- **Concept state** per `(learner, concept)`: a small vector across evidence dimensions.

### C.2 Evidence dimensions

| Dimension | Meaning | Raised by | Never raised by |
|---|---|---|---|
| **Recall** | Can state the point without prompting | scored attempts, honest self-grades | listening |
| **Explanation** | Can explain it clearly and in order | spoken or typed explanation attempts with a Verdict | listening |
| **Application** | Can use it on a scenario | scenario, defend and boss attempts | listening |
| **Delivery** | Says it fluently under time | spoken attempts (pace, fillers, structure) | typed attempts |
| **Discrimination** | Can spot a wrong explanation | catch-the-error challenges | listening |
| **Exposure** | Has encountered it | listening, reading the model answer | n/a, counts only |

Each dimension stores: strength estimate, evidence count, last evidence time and a source breakdown (scored / self-graded / heuristic / legacy). Strength decays with the Recall curve; confidence is a function of evidence count and recency, so "not enough evidence" is a first-class answer.

### C.3 Rules that keep it honest

- Listening writes only Exposure. It may lower the planner's *priority to teach* a concept and raise its priority to *probe* it, never its strength.
- Self-grades count, at lower weight than a scored attempt, and are tagged.
- Heuristic native scores (no AI) count at low weight and cannot move Explanation or Application, only Recall and Delivery.
- `analysis_failed` and `too_short` attempts write no strength at all.
- Legacy rows are imported with their provenance and a reduced weight (section N).

---

## D. Knowledge graph

### D.1 Shape

- **Concept**: id, name, kind (`skill`, `topic`, `technology`, `behaviour`, `story`), aliases, short definition.
- **Edges**: `prerequisite_of`, `related_to`, `part_of`. Directed, typed, each with `source` and `confidence`.
- **Links**: `question -> concept` (many to many, with weight), `concept -> role/company` (via Goal prep sets), `episode segment -> concept`.
- **Stories and facts** link to concepts they evidence. The fact sheet stays the grounding source for claims; concepts only reference fact ids.

### D.2 Provenance and confidence (non-negotiable)

Every concept, edge and link carries `{source: human | llm | rule | import, model, promptVersion, confidence 0..1, reviewedAt?, reviewedBy?}`. LLM-built links start at "proposed". Nothing proposed gates the scheduler. Planner use of a proposed link is allowed only with a lower weight and never in anything shown as a mastery claim. A review queue (a sample, not everything) promotes links. Bank titles and folder names are used as a *prior*, never a fact.

### D.3 Stable content identity and `LearningKey`

Evaluation of the stage-1 `LearningKey` (normalised bank title plus FNV-1a hash of normalised question text):

- **Good:** deterministic, survives seed wipes and CloudKit duplicate rows, cheap, tested. 64-bit FNV collisions are negligible at this scale.
- **Mutates:** rename the bank or edit the question text and the key changes, so history detaches silently. The hint-editing and question-fix workflows already happen.
- **Collapses:** two identical questions in one bank get one key (fine for scheduling, wrong for counting).
- **Not shared:** it is native-only, and web bank titles and native bank names are not guaranteed identical, so it does not join the platforms.

Decision: `ContentId` is a random UUID assigned once to each question and stored with it on both platforms. `LearningKey` is demoted to a **one-time matching key** used to backfill ids and then stored in a `QuestionAlias(contentId, aliasKind, aliasValue)` table so old data keeps resolving after renames. Web question cuids and native `BankQuestion` ids become aliases. Native stage-1 state is re-keyed by replaying its review log through the alias table (section N).

Bank identity follows the same rule: `bankUid` assigned once, title is a label. Episode R2 keys stay `audio/study/<bankId>` (additive sidecar for segments), so nothing already published moves.

---

## E. Evaluation contract (Verdict)

### E.1 One attempt record

Every practice, quiz, voice, quiet or challenge result is a Ledger event of kind `attempt`:

```
Attempt {
  eventId          client-generated UUID (idempotent writes)
  learnerId, contentId, goalId?
  modality         spoken | typed | outline | dictated | voice_conversation | quiz | challenge:<kind>
  startedAt, durationMs, hintUsed
  engine           { provider, model, promptVersion, rubricVersion, kind: llm | heuristic | self }
  status           scored | analysis_failed | too_short | skipped | suspect_legacy
  dimensions       { name -> { score01, raw, scale } }   (every dimension computed, all persisted)
  delivery         { wpm, fillers, pauses, ... }          (persisted, not discarded)
  claimsCheck      { flagged: [...], groundedFactIds: [...] }
  evidence         { transcriptRef, audioRef?, retention }
  selfGrade?       again | hard | good | easy
  verdictSummary   whatWasRight, whatToFix, betterWording   (for display only, not for scheduling)
}
```

### E.2 One rubric

- Internal scale 0..1 per dimension; each surface renders bands or 1 to 5 for display. The web 0 to 10 and 1 to 5 mix and the native heuristic scale are mapped once, in one module, with the mapping versioned.
- The web rubric is the base because it carries the honesty rules the audit praised: never mark down missing figures, flag unsupported figures against the fact sheet, deterministic claims check.
- Native heuristics that reward numbers and jargon are retired as a *scorer* and kept only as an offline *fallback* with `engine.kind = heuristic`, low weight and an on-screen "quick check, not a full review" label.
- The unreachable native on-device model stub is removed rather than kept as a pretend engine.
- `rubricVersion` and `promptVersion` are stored so a rubric change is a re-score decision, not a silent drift.

### E.3 Failure provenance

- A failed or timed-out analysis writes `status = analysis_failed` with an error class and **no dimensions**. The canned all-4s and all-2s results stop being generated.
- The learner is told plainly ("couldn't score that one, nothing was recorded") and can retry.
- Existing canned results are identified by signature (identical dimension values plus the fixed canned feedback strings) and migrated as `suspect_legacy`, excluded from Recall (section N).

---

## F. Planner (Today)

One pure function, run on server and on device from the same spec and golden test vectors:

```
plan(state, goals, now, constraints{ minutes, mode: normal|quiet|commute|chaos, energy? }) -> Plan
```

Inputs: due items, mistakes queue, weak concepts with confidence, Goal date and prep set, concept coverage gaps, recent exposure, recent challenge variety, free-tier limits.

Output items carry `kind` (`retrieve`, `learn`, `explain`, `scenario`, `challenge`, `mock`, `boss`, `rest`), a target (contentId or conceptId) and a **reason string** shown to the learner ("Due today", "You've missed this twice", "Prismic is in 2 days and this isn't covered yet"). Explainability is a requirement, not decoration.

Policy sketch (details tuned with real data, not guessed now):

- Goal in the next 14 days: compress intervals (section G), weight coverage of the Goal's prep set, include one challenge.
- No Goal: weak concepts and due items only; light.
- Quiet mode: only modalities that need no speaking (typed, outline, listening probes).
- Always: a plan is 5 to 8 items, completable in minutes, with a visible "that's enough for today" end. One free rest day per week, automatic, never framed as a miss.
- Seeded by day so the plan is stable within a day and shuffles across days.

The stage-1 `PlanBuilder` (tested, pure) is the starting point. It is ported to the shared spec; native keeps a Swift implementation validated against the same vectors.

---

## G. Memory scheduling (Recall)

### G.1 Decision

FSRS, per question, desired retention 0.9, as in stage 1. One spec, two implementations (TypeScript on the server, Swift on device) validated against a shared golden-vector file. Native must schedule offline, so the server cannot be the only implementation.

### G.2 Interview compression

Stage-1 rule kept: when a Goal is upcoming, cap the interval at 40 percent of days remaining (minimum 1 day), so every item gets at least two more looks before the date. A test asserts every due date precedes the Goal.

### G.3 Migration from SM-2 and native intervals

Initial FSRS state seeded from existing data: stability from the current interval, difficulty from ease factor (web) or average score (native), due date preserved. **Shadow mode first:** both schedulers run, only the old one drives the UI, differences are logged, then cutover. No learner loses a due date.

### G.4 Retiring the flip cards

`/study` becomes **Recall practice**: the learner attempts first (type, outline or speak), then sees the model answer and self-grades. That writes a real `attempt` (modality quiet, `engine.kind = self`). Reveal-before-attempt is removed. `/study` redirects to Today. This is a replacement, not a flashcard feature.

### G.5 Deferred tuning

Per-learner FSRS parameter fitting needs a few hundred reviews. Defer until there is data (section Q).

---

## H. Readiness

Per Goal, not global. Components:

- **Coverage** of the Goal's prep set (concepts touched with enough evidence).
- **Strength** (Recall and Explanation, decayed to the Goal date).
- **Application** and **Delivery**, shown separately.
- **Confidence** (how much evidence), shown always.

Presentation: bands with evidence counts ("Strong on 6 of 11 topics. Not enough evidence on 3."), never a single number without its basis. Listening and heuristic-only results cannot lift a band. The stage-1 boss bar (share graded Good or Easy in 14 days) is replaced by this once Concept state exists; until then it stays, labelled as a rough guide.

---

## I. Spoken architecture

- **One loop, three modalities.** Spoken, typed and outlined answers go through the same `attempt` path and the same Verdict. Quiet practice is a first-class mode because typing a full answer is long: outline mode (tap the beats of the answer, add a few words each) and dictation are the quiet options.
- **Turn-taking first, full duplex later.** Voice conversation v1 is push-to-talk with a visible state machine: question, answer, one follow-up, feedback. The follow-up policy is driven by the rubric gap (probe the weakest dimension). This is the existing `feat/voice-conversation` design made to persist its data.
- **Persist what is computed.** Conciseness, pacing, emphasis, engagement and the claims check are saved with the attempt, so they can trend.
- **Voice sessions complete.** Mock, pitch and voice sessions call completion so they produce summaries and write to the Ledger.
- **STT:** Whisper large-v3-turbo on the server; Apple speech on device. Transcript is the stored evidence by default.
- **Audio retention:** default to deleting the recording after scoring and keeping the transcript. Longer retention is an explicit learner choice (decision R.6). Current behaviour keeps recordings indefinitely, which this changes.
- **Cost guard:** per-learner daily AI cap and rate limits on every AI route before any of this is exposed beyond one user.
- **Latency budget (to be measured, not assumed):** a target for end of speech to follow-up start is set in P6 and measured on the real microphone, which has never been exercised.

---

## J. Podcast architecture (Script)

### J.1 Structured episode

An episode becomes `audio/study/<bankId>.mp3` (unchanged, so nothing published breaks) plus a **Script sidecar** `audio/study/<bankId>.script.json`:

```
Script {
  version, bankUid, hosts: [jess, zac], generatedWith: { model, promptVersion, voice }
  segments: [{
    id, speaker, text, startMs, endMs,
    kind: explain | banter | probe | recap | challenge,
    contentIds: [...], conceptIds: [...],
    interaction?: { type: recall | predict | spot_error, prompt, expects: [...] }
  }]
}
```

The pipeline already assembles per-line clips and discards the timings. It keeps them instead. That one change unlocks chapters, resume at a segment, per-segment regeneration, listening events tied to concepts, and "pause and ask".

### J.2 Interaction

- **Phase 1, static:** interaction points are markers. The player pauses at a marker, shows the prompt, the learner answers by typing or speaking, and the attempt goes to the Ledger. No generation at playback.
- **Phase 2, per-learner:** episodes regenerated from weak concepts or an upcoming Goal, stored per learner.
- **Not planned:** live generative reaction during playback. Deferred (Q).

### J.3 Listening events

Playback writes `listen` events (episode, segment range, completion). They produce Exposure only and may add a probe to Today. Never mastery.

### J.4 Generation grounding and guards

- Source builder reads questions, hints and fact-sheet facts for the bank, plus an optional learner summary derived from the Ledger.
- Existing guard kept and tested: no host named Luna or Sol, no Lunary or Grimoire branding in interview-prep audio.
- New guard: no first-person anecdotes or invented personal history for hosts (section K).
- Old episodes whose outro mentions Lunary are flagged for re-cut rather than silently kept (decision R.7).

### J.5 Podify and storage

Podify stays the renderer for now, called with a Script instead of free text, and with its public blob feed disabled for private episodes (current practice of running with an empty blob token is replaced by an explicit private mode). The Script schema is owned by iPrep, not Podify, so the renderer can change. Per-learner storage for other people: private bucket prefix keyed by learner, signed URLs, offline cache on device. The "stored securely on their iCloud" idea is kept as a later option behind the same episode-source interface (Q).

### J.6 Cost note

Orpheus is about $7 per million characters, Kokoro about $0.62. A ten-minute two-host episode is the unit; per-learner personalised episodes are feasible but must be measured in P7 before any promise. Storage is about 13 to 15 MB per episode, so caching and expiry rules are needed per learner.

---

## K. Jess and Zac (Hosts)

- **Persona spec** in a versioned file: role, voice id, tone, vocabulary, what they may and may not claim. Per the learner's description, one host leans into the question and knowledge side, the other into the answer and query side; the spec encodes that division and keeps them from drifting into identical voices.
- **Grounded memory only.** A host may reference a Ledger fact ("you've missed the caching one twice this week") and may not reference anything else about itself or the learner. No invented backstories, no feelings about shared history, no claims to have done the job.
- **Enforcement:** every memory reference in a generated script must carry the Ledger event or fact id it came from; a validator rejects scripts with uncited personal references. Plus the existing brand-name guard.
- **Consistency over cleverness:** tone is stable across episodes, in practice sessions and in the UI. They are narrators and sparring partners, not characters with arcs.
- **Honesty:** they are clearly AI voices in the product copy.

---

## L. Engagement, challenges, Chaos, boss sessions

### L.1 Challenge framework

```
Challenge { id, kind, constraints, rubricFocus, timeBudget, eligibility(conceptState), copy }
```

Kinds, in build order: **rapid-fire** (short answers, timer), **explain-to-a-junior**, **scenario**, **defend your answer** (one pushback), **catch the error** (static first), **constraint** (30 seconds, no jargon). Each is a modality variant of an attempt, so every result lands in the Ledger and updates Recall.

### L.2 Chaos

Chaos is the planner choosing a Challenge: eligible by concept state, biased to weak and stale concepts, avoids repeating recent kinds, always shows a one-line reason, always skippable. It is a planner mode, not a separate system.

### L.3 Boss session

A mock interview built from a Goal's prep set. Optional, opened by the learner or offered when readiness bands support it. Produces a summary of what improved, never a pass or fail verdict, and no loss on a rough result.

### L.4 Keep from stage 1, with changes

Story deck, wins card, XP, one rest day a week, optional nudge. Moves to Ledger-derived values so they match across devices. No leaderboards, no loss messaging, nudge stays off by default.

---

## M. Cross-platform strategy

- **Server of record for learner state; native is offline-first.** Web (Neon) holds the Ledger and derived state. Native keeps a local copy and an outbound event queue. Because the Ledger is append-only with client-generated event ids, sync is a push of new events and a pull since a cursor. There are no conflicting edits to resolve.
- **One account.** Web account linked to native by Sign in with Apple (native already offers it); web gains Apple or email sign-in. Linking merges learners deliberately, with a preview (decision R.2).
- **CloudKit:** frozen. No new `@Model` types and no schema fields added. It keeps carrying existing banks and due dates until the server path is the source of truth, after which it is demoted to a cache or retired. The silent fallback to local-only is replaced by a visible state.
- **Content sync by id.** Banks, questions and episodes are matched by `ContentId` and `bankUid`, never by title or copied text.
- **Offline:** device keeps the plan inputs, scheduler and recent state, and episodes cached per the manifest, so a flight or a tube ride still works.
- **Notion:** interviews flow in through the existing sync into Goals; no write-back needed for v1.

---

## N. Migration strategy

Principles: additive first, shadow before cutover, replayable, reversible until the last step, nothing destructive on a shared database.

### N.0 Prerequisite: isolate preview from production

Before any non-trivial migration: a separate Neon branch (or database) for Preview and Development, with Production's credentials unreachable from preview builds. Until then, **only additive migrations may be merged or even previewed**. Also baseline the migration history (hand-written SQL and "column does not exist" fallbacks show drift) so `migrate deploy` is trustworthy.

### N.1 Order

1. **Identity (additive):** `contentId`, `bankUid` and `QuestionAlias`. Backfill by a dry-run report first (counts of matched, duplicated and orphaned questions), then apply.
2. **Attempt v2 (additive):** new Ledger tables written in parallel with the existing `SessionItem` writes. Old reads untouched.
3. **Backfill the Ledger from history:** `SessionItem` joined through `Session` for the user; every row tagged `source = legacy`; canned-result signatures tagged `suspect_legacy`; native stage-1 review log (120 days, grade-only) tagged `native_stage1` with no dimension scores.
4. **Scheduler shadow run, then cutover** (G.3).
5. **Native:** push events through the server; stage-1 JSON becomes a cache rebuilt from the Ledger; delete only after parity.
6. **Concept Map:** additive tables, enrichment run offline into a "proposed" state.
7. **Script sidecars:** additive objects on R2 next to existing mp3s.

### N.2 Highest-risk migrations

| Risk | Why | Mitigation |
|---|---|---|
| Preview writes to production | shared database | N.0 first; additive-only until then |
| Question identity backfill | duplicates, seed wipes, CloudKit duplicate ids, renamed banks | dry-run report, alias table, no deletes, idempotent apply |
| SM-2 to FSRS cutover | a bad mapping loses or bunches due dates | shadow mode, compare distributions, per-user rollback flag |
| Canned-score detection | false positives hide real attempts, false negatives keep fake data | signature plus manual spot check on a sample, tag not delete, reversible |
| Account linking | merges two learner histories | preview step, explicit confirmation, reversible link, never automatic |
| CloudKit schema | one-way deploy, silent fallback | no schema changes at all in this plan |
| Native tab and screenshot regressions | Review moved under More | update screenshot test in the same change |

---

## O. Security and privacy

Done **before** any new shared API ships:

1. Require auth and ownership on `GET /api/banks/[id]` and `/api/banks/[id]/audio`, on `POST /api/quizzes/attempt`, and on every route that takes an id.
2. Replace `x-internal-key` as an admin alias with a separate machine principal that has scopes (read banks, append questions, create folders) and rotate the key.
3. Remove hard-coded credentials from `generate_n8n_episodes.mjs` and seed scripts, rotate what they exposed, and add a secret scan to CI.
4. Rate limits and a per-learner daily AI cap on all AI routes.
5. Preview isolation (N.0).

Privacy defaults for the new system:

- Transcript kept, audio deleted after scoring unless the learner opts in.
- A learner can export and delete their Ledger.
- Per-learner episodes private by default, signed URLs, no public feeds.
- No ad tooling or third-party analytics on learning content; no claims of encryption beyond what is true.
- Retention windows written down per data class (attempts, transcripts, audio, episodes).

---

## P. Implementation phases

Each phase: objective, systems, dependencies, migrations, risk, tests, user-visible improvement, what it enables.

### P0. Safe ground
- **Objective:** make it safe to change the data.
- **Systems:** preview isolation, migration baseline, security items O.1 to O.5, merge PR #5, connect Notion on the mini.
- **Dependencies:** none (needs her to share the Notion database with the integration).
- **Migrations:** none destructive.
- **Risk:** low; one-off config work on Vercel and Neon.
- **Tests:** unauthenticated requests rejected; preview build cannot reach the production database.
- **User-visible:** upcoming interviews appear in the app automatically; nothing broken.
- **Enables:** every later phase.

### P1. Shared question identity and complete attempt records (build first)
- **Objective:** one id for a question everywhere, and every attempt stored with its full provenance.
- **Systems:** `ContentId`, `bankUid`, `QuestionAlias`, Attempt v2 and Ledger tables, failure provenance, persist discarded scores.
- **Dependencies:** P0.
- **Migrations:** additive; backfill with dry-run; legacy rows tagged.
- **Risk:** medium (backfill matching, canned-score detection).
- **Tests:** backfill dry-run counts reconcile; idempotent apply; a failed analysis writes no dimensions; scheduler ignores non-scored attempts.
- **User-visible:** failed analyses stop poisoning scores and weak topics; a retry prompt instead of fake feedback.
- **Enables:** everything else; cross-platform state, honest SRS, trends, personal bests.

### P2. One account and event sync
- **Objective:** web and native share a learner.
- **Systems:** Apple and email sign-in on web, account linking, event push and pull, native outbound queue, stage-1 state imported by log replay.
- **Dependencies:** P1.
- **Migrations:** account link table; no merge without confirmation.
- **Risk:** medium to high (identity merge).
- **Tests:** idempotent event ingestion; offline queue replays in order; link and unlink round trip.
- **User-visible:** practise on the phone, see it on the web, same due list.
- **Enables:** unified scheduling and planning.

### P3. One scheduler
- **Objective:** Recall replaces SM-2 and the native FSRS draft.
- **Systems:** shared FSRS spec, golden vectors in TS and Swift, shadow run, cutover, `/study` replaced by Recall practice.
- **Dependencies:** P1, P2.
- **Migrations:** seed FSRS state from SM-2 and native intervals; keep old columns until parity.
- **Risk:** medium (due-date shifts).
- **Tests:** golden vectors pass in both languages; no due date after the Goal date during compression; shadow diff within tolerance.
- **User-visible:** consistent due dates on both platforms; flip cards gone, replaced by attempt-first recall.
- **Enables:** Today everywhere, readiness.

### P4. Concept Map v1
- **Objective:** a first, honest concept layer.
- **Systems:** concept tables with provenance, offline LLM enrichment of hints into proposed concepts and links, sampled human review queue.
- **Dependencies:** P1.
- **Migrations:** additive.
- **Risk:** medium (LLM quality). Mitigated: proposals only, low weight, reviewed sample.
- **Tests:** provenance present on every row; proposed links never gate the scheduler; review sample metrics.
- **User-visible:** topic view of strengths and gaps.
- **Enables:** concept-level state, varied retrieval, weak-concept episodes, readiness.

### P5. Today on both platforms
- **Objective:** one planner, explainable.
- **Systems:** shared planner spec, server and Swift implementations, Goal entity unifying Interview, reasons shown.
- **Dependencies:** P2, P3 (P4 improves it but is not required).
- **Migrations:** `Goal` generalises `Interview` additively.
- **Risk:** low to medium.
- **Tests:** golden plan vectors across languages; plan stability within a day; quiet mode contains no speaking items.
- **User-visible:** the same sensible plan on web and phone, with reasons.
- **Enables:** challenges, Chaos, boss.

### P6. Spoken unification and persistence
- **Objective:** one Verdict, voice conversation that works and saves.
- **Systems:** unified rubric and mapping module, merge `feat/voice-conversation` after a real microphone test, quiet modes (outline, dictation), session completion for mock, pitch and voice, audio retention setting.
- **Dependencies:** P1; P3 for scheduling effect.
- **Migrations:** rubric version tags on new attempts.
- **Risk:** medium (real-world audio, latency).
- **Tests:** rubric mapping fixtures; voice state machine; transcript-only retention path.
- **User-visible:** back-and-forth practice, quiet options, summaries after every kind of session.
- **Enables:** challenges, hosts that react.

### P7. Structured episodes and listening
- **Objective:** Script sidecars, listening events, pause-and-ask.
- **Systems:** keep per-line timings, Script schema, player chapters and markers, `listen` events, re-cut flagged legacy outros.
- **Dependencies:** P1 (ids), P4 (concept ids, optional).
- **Migrations:** additive R2 objects.
- **Risk:** medium (audio assembly, cost).
- **Tests:** timings sum to the mp3 duration within tolerance; markers resolve to real content ids; guard tests (no Luna, Sol, Lunary).
- **User-visible:** chapters, resume, a recall prompt in the middle of an episode.
- **Enables:** per-learner episodes.

### P8. Hosts memory and personalised episodes
- **Objective:** Jess and Zac that know what the learner did, truthfully.
- **Systems:** persona spec, grounded memory with citation validator, per-learner weekly episode from weak concepts or the next Goal, private storage and cache.
- **Dependencies:** P4, P5, P7.
- **Risk:** medium (hallucinated personal claims). Mitigated by the validator.
- **Tests:** validator rejects uncited personal references; cost measured per episode.
- **User-visible:** a short episode about exactly what is weak before the interview.
- **Enables:** the full loop.

### P9. Challenges, Chaos, boss sessions, readiness
- **Objective:** the fun and the finish line.
- **Systems:** challenge framework and kinds in L.1 order, Chaos as a planner mode, boss session, multidimensional readiness, Ledger-derived wins.
- **Dependencies:** P5, P6 (P8 optional).
- **Risk:** low to medium.
- **Tests:** eligibility rules; no repeats within a window; readiness never raised by listening.
- **User-visible:** variety, a rehearsal for the real day, a readiness view that explains itself.

---

## Q. Explicit deferrals

- Live generative reaction during playback.
- Full-duplex voice with barge-in.
- Per-learner FSRS parameter fitting.
- Public Notion template and OAuth for other users (documented in `docs/interviews-and-notion.md`, not built).
- Per-user iCloud episode storage (the episode-source interface keeps the door open).
- Leaderboards, social features, any loss-framed streak.
- Android, and any new native platform.
- Retiring CloudKit entirely.
- Re-cutting every old episode (only flagged ones, per R.7).
- Concept-level generation of new questions (varied retrieval is first done by choosing among existing questions).

---

## R. Decisions required

These are the product calls the code cannot answer.

1. **Is the web backend the source of truth for the phone too?** The plan assumes yes (server of record, native offline-first). The alternative keeps native on-device and CloudKit only, which makes cross-device state and the hosts' memory much harder.
2. **Account linking.** Sign in with Apple on web as well, or email? And when two histories exist, merge with a preview, or keep them separate?
3. **Other learners.** Is iPrep staying a one-learner tool in the near term, or is a public version in scope? It changes how strict P0 security and cost caps need to be on day one, and whether per-learner episode storage is real.
4. **Concept Map review.** How much of the proposed links do you want to review by hand, and is "proposed, low weight" acceptable for planning in the meantime?
5. **Rubric.** Is the web rubric (honesty rules, no marking down for missing figures) the one standard for both platforms, with native heuristics only as an offline fallback?
6. **Audio retention.** Delete recordings after scoring and keep transcripts (recommended), or keep recordings for self-review?
7. **Old episodes.** Re-cut the ones that end with a Lunary mention, or leave them as they are?
8. **Podify public feed.** Remove the two private episodes it published to its public feed earlier?
9. **Voice conversation.** Merge `feat/voice-conversation` after a real microphone test, or fold its design into P6 from scratch?
10. **Cost ceiling.** What monthly spend on AI and audio is acceptable while this is a personal tool, so the per-learner cap has a number?
