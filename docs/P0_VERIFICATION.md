# P0 verification notes

## Baseline test failures (pre-existing, not regressions)

Two tests fail on `origin/main` at `1e4bbd8`, before any P0 change, and still fail with the P0 commits. They are
accepted baseline failures and were deliberately **not** changed or weakened by P0:

| Test | File |
| --- | --- |
| `POST /api/sessions > returns error for invalid bankId format` | `__tests__/api/sessions.test.ts` |
| `Learning Analytics > analyzeSessionPerformance > should calculate performance by tag correctly` | `__tests__/lib/learning-analytics.test.ts` |

Reproduce on a clean checkout of `origin/main`: `pnpm install --frozen-lockfile && pnpm vitest run` gives
2 failed, 271 passed (273) there. With P0 the suite is 2 failed, 399+ passed; the two failures are the same two.
If any other test fails after a P0 change, that one is a regression.

## Typecheck, lint and build

- `pnpm typecheck` is clean on `origin/main` and with P0.
- `pnpm eslint app lib __tests__` has one pre-existing warning (`react-hooks/exhaustive-deps` in
  `app/(dashboard)/practice/session/[id]/page.tsx`).
- `pnpm build` (`prisma generate && next build`) passes with no database reachable and no migration variable set.
