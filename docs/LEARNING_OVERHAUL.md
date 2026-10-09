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
| Multi-bank sessions | WORKING in code: `Session.extraBankIds` (additive migration `20261009090000_session_extra_banks`, rollback `docs/session-extra-banks-rollback.sql`); practice page uses checkboxes. **Migration not applied to Preview or Production.** | `app/api/sessions` |
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
