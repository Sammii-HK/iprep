# Learning overhaul: status and capability matrix

Branch: `claude/upbeat-thompson-6x476s` (built on `p2/consolidated`, the newest server branch).
Scope of this repo: the web app and server. The iOS app, XP/levels, Today and Story live in
`iprep-ios` and are **not** touched here.

Everything below marked BUILT is a pure, unit-tested library. None of it is wired into API
routes or UI except where stated. Nothing is deployed, migrated, or deleted.

## Capability matrix

| Capability | State | Where |
|---|---|---|
| Remember selected banks / mode / count (web) | WORKING (single bank), wired in `practice/page.tsx` | `lib/practice-preferences.ts` |
| Per-context selection memory, presets, manual vs recommended | BUILT, presets and recommendations not yet in UI | `lib/practice-preferences.ts` |
| Resume unfinished session | WORKING (latest unfinished server session); saved resume pointer BUILT, unused | practice page |
| Multi-bank sessions | NOT NEEDED on the server: the iOS app already practises several banks. The proposed `extraBankIds` migration was reverted and never applied. | n/a |
| Learning contexts, question-level filtering | BUILT (keyword heuristics), bank list filtered by title only in UI | `lib/learning-context.ts` |
| Administrative questions excluded | WORKING in smart session ordering; the default (non-smart) path and other consumers still include them | `lib/learning-context.ts` |
| Intelligent selection (new/due/weak/stale/recent/dedupe/interleave/explain) | WORKING for session questions via `GET /api/sessions/[id]?smart=1` (the practice session page requests it); stable on resume; administrative questions removed. Interview/role terms are not passed yet | `lib/question-selection.ts`, `lib/session-questions.ts` |
| Role profiles, multiple targets, interview weighting | BUILT, not wired | `lib/role-profiles.ts` |
| Question-quality audit | BUILT. CSV mode ran on the 6 seed banks (89 questions). `--db` mode (read-only transaction, facts bank excluded) verified on a throwaway local database only; **not run on your real data** | `lib/question-quality.ts`, `scripts/audit-questions.ts` |
| Terminology no longer penalised as repetition | WORKING in `/api/practice` and reanalyze | `lib/audio-analysis.ts` |
| Question-aware rubrics | WORKING in code: in the evaluator prompt as prompt@2 / rubric@2 (hash pinned). **Not compared against the live model; not deployed.** | `lib/rubrics.ts`, `lib/ai-optimized.ts` |
| Grounded analysis, failed evaluation yields no score, capped feedback | BUILT, not yet connected to the AI call | `lib/answer-analysis.ts` |
| Concept graph + evidence-derived state | BUILT; no concepts or questions are populated yet | `lib/concept-graph.ts` |
| Readiness with uncertainty, Today planner | BUILT, not wired | `lib/readiness.ts` |
| XP rules, Chaos, Boss, Teach-back, seasonal celebrations | BUILT as rules/data; no UI, no voice | `lib/engagement.ts` |
| Interactive podcasts, Jess/Zac memory | NOT PRESENT |  |
| iOS counterparts | NOT TOUCHED (other repo) |  |
| Failed AI evaluation never becomes a score | WORKING in P1/P2 ledger (existing); mirrored in `answer-analysis` | existing + new |

## Safety

No schema change, no migration, no deletes, no change to the canonical Attempt/Evidence/Evaluation/
Measurement semantics, no transcript upload, no RevenueCat or account-identity change.
The audit proposes actions; nothing is archived or edited.

## Known gaps

- Heuristics (contexts, administrative detection, audit classes) are keyword-based and tuned on
  fixtures and the 6 seed banks, not on your real banks.
- Audit of your real banks needs database access (read-only) and has not been run.
- Putting rubrics into the evaluator prompt requires bumping `promptVersion`/`rubricVersion` and pinning a new hash in `__tests__/lib/evaluator-version-guard.test.ts`. It changes live scoring and adds prompt tokens, so it is held for approval and a before/after run against the real model. Until then rubrics are not part of the live evaluator prompt, so scoring in production is unchanged
  except for the terminology fix. Rolling them in needs a versioned evaluator change and a
  before/after run on a calibration set against the real model.
- Concept extraction (mapping real questions to concepts) is not done.


## iOS (repo `iprep-ios`, branch `feature/local-learning`, based on `p2/native-sync-on-release`)

The app is local-first (SwiftData + CloudKit, local FSRS file, on-device scoring), so the learning intelligence belongs
there, private and without a server. Not compiled in the authoring environment: run `xcodegen generate`, build, test.

| Capability | State |
|---|---|
| Remember chosen banks per context (local, mirrored to the learner's iCloud key-value store, newest wins) | BUILT (`Services/Learning/PracticePreferences.swift`), wired into `PracticeView` |
| Ranked question picking instead of `randomElement()` | BUILT (`QuestionRanker.swift`), wired into `PracticeView` |
| Learning context chip (applies to "All banks" only; chosen banks never filtered) | BUILT |
| Interview-aware Today plan, rest-day streak, XP, mistakes loop, story levels | WORKING already; unchanged |
| Recruiter logistics / other-context questions kept out of Today | BUILT (`PlanBuilder` filter) |
| Readiness admits sparse evidence | BUILT ("Not enough practice to tell yet" below 5 answered) |
| Subject vocabulary not reported as overused; pause-only fillers; no "add numbers" feedback | BUILT (`ScoringService`, `ScoringTerminology`) |
| Question-aware rubric in the on-device model prompt; missing model score fails instead of defaulting to 3.0 | BUILT, but the model call is still stubbed (`FoundationModelsBridge` always throws), so the rule-based scorer is what runs |
| Concept graph, Chaos/Boss/Teach-back, per-dimension readiness | NOT BUILT on iOS (TypeScript versions exist in `lib/`) |
| Interactive podcasts, Jess/Zac memory | NOT PRESENT |

## Web additions
Smart session ordering
(`?smart=1`, now interview-aware), rubrics in the evaluator prompt (prompt@2/rubric@2, not compared with the live model),
Recommended-for-interview strip (`recommendForInterview`), read-only audit script with `--db` mode.

## Data lives on the device and in iCloud

- `scripts/export-legacy-banks.ts` exports server banks (read-only, facts bank never read) to the app's full-import JSON so they can
  live in the app and the learner's iCloud. Run it yourself with `AUDIT_DATABASE_URL`; it was tested only on a throwaway database.
- iOS **Settings > Question quality > Review questions** audits the banks already on the device and lets the learner leave questions
  out of practice and Today, reversibly (`PracticePreferences.excludedKeys`, device + iCloud key-value store). Nothing is deleted or
  edited. Stories are not audited. A plan already built today is not rebuilt when a question is left out; the next plan honours it.
- The on-device model (`FoundationModelsBridge`) is now a real call behind `canImport(FoundationModels)`; it needs an iOS 26 SDK build
  and a device with Apple Intelligence to verify.


## Requirement audit against the original brief (honest)

Legend: DONE = built and tested where tests can run. UNVERIFIED = written but not compiled/run (all Swift; the web prompt change
and on-device model). PARTIAL / NOT DONE are stated plainly.

| Brief | Status |
|---|---|
| 1 Remember selections, per-context memory, resume | DONE on web (single bank) and UNVERIFIED on iOS. Named presets exist only as a tested TypeScript library, no preset UI on either platform: PARTIAL |
| 2 Goal-aware, multiple target roles, interview-specific prep | Web "Recommended for your interview" DONE. iOS Today already interview-aware (existing). Multiple target roles: library only, no screen to set them, web uses only the next interview's role: PARTIAL. No recommendations strip on iOS |
| 3 Separate learning contexts | DONE on web and UNVERIFIED on iOS (context menu, plan and practice filtering) |
| 4 Question quality audit | iOS Review questions screen UNVERIFIED. Web CSV audit ran on the 6 seed banks. NOT run on your real banks (no access). Revisions via QuestionRevision not used: nothing is rewritten |
| 5 Question selection | DONE on web (smart=1) and UNVERIFIED on iOS (QuestionRanker) |
| 6 Scoring quality | Web: terminology fix DONE, rubrics in prompt@2 but NOT compared with the live model. iOS: fairness fixes UNVERIFIED; on-device model enabled UNVERIFIED |
| 7 Answer analysis (demonstrated/mentioned/missing/misconceptions, grounding) | Library + tests only (`lib/answer-analysis.ts`), NOT wired into the evaluator output or any screen: NOT DONE in product. iOS already shows per-point coverage from your own notes (existing) |
| 8 Learning graph | iOS seed graph + "Revisit first" UNVERIFIED. No interactive visual graph screen: NOT DONE |
| 9 Today | Existing interview-aware plan kept; admin/other-context filtering added UNVERIFIED |
| 10 Spoken modes | Text follow-ups only (Teach-back UNVERIFIED). Conversational interviewer, scenario/timed/compare modes, spoken teach-back: NOT DONE |
| 11 Interactive podcasts, Jess/Zac memory | NOT DONE |
| 12 Chaos | Prompt twist banner UNVERIFIED. Scoring is not twist-aware (no-jargon answers can still be marked down by the keyword depth scorer): PARTIAL |
| 13 Boss battles | NOT DONE (existing mock interview and "Interview boss level" gauge only) |
| 14 Better mock interviews | NOT DONE |
| 15 Readiness | "Not enough practice to tell yet" UNVERIFIED. Per-dimension readiness: NOT DONE |
| 16 Gamification | Existing XP/levels/streaks untouched. Evidence-aware XP and seasonal celebrations: NOT DONE on iOS (TypeScript rules only) |
| 17-19 Preserve history / safety | Nothing deleted, nothing migrated, no ledger semantics changed |
| 21 Verification | Unit tests only. No UI automation, no real-device run, no iOS test run |


## Verification update (what actually ran)

| Check | Result |
|---|---|
| Web unit/API/DB tests (local Postgres 16) | 772 passed, 3 failed. The 3 fail on the base branch too or need network (`sessions` invalid bankId, `learning-analytics` tag performance, `cleanup-audio-guard` fetching `tsx`) |
| Web lint / typecheck / `next build` | 0 lint errors, 0 type errors, production build succeeds |
| Browser check of `/practice` (`e2e/practice-page.cjs`, Chromium, mocked API) | 12/12: bank remembered after reload, Interview hides fundraising, Founder/Fundraising show theirs, switching back restores, Recommended does not change selection until Use, roles and presets persist, no page errors |
| Swift pure logic on Linux (`scripts/verify-pure-logic.sh`, Swift 6.0 container) | 60/60: contexts, preferences, ranker, audit, concept graph, teach-back, chaos, terminology, rubric, scoring fairness, plan filter |
| Swift UI/SwiftData/CloudKit files (PracticeView wiring, ScorecardView, SettingsView, ReviewQuestionsView, LearningInsightsView, FoundationModelEngine) | NOT compiled or run: they import Apple frameworks. Need Xcode |
| Scoring calibration (`__tests__/lib/scoring-calibration.test.ts`) | Found and fixed two real filler false positives ("..., like colours", "..., so rendering") |

Still NOT done: interactive podcasts and Jess/Zac memory; conversational/spoken interview modes; multi-stage Boss battles; mock-interview
improvements; per-dimension readiness; evidence-aware XP and seasonal celebrations on iOS; twist-aware (no-jargon) scoring; model-grounded
concept analysis (needs a live-model change and comparison); the audit on the real banks; Xcode build, on-device model and iOS UI tests.
