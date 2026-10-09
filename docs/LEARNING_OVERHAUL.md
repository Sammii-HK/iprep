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
