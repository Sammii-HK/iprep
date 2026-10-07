# P2: gates, debt classification and merge ordering

Status: written after PR #9 (native sync) was approved on its merits. Nothing here applies P2 to Production.

## 1. Merge ordering hazard (read before merging PR #9)

Merging to `main` triggers an automatic Production build and deploy on Vercel (the Ignored Build Step only skips
docs-, scripts- and markdown-only changes; PR #9 changes application code). The P2 application code reads columns and
tables that exist only after migration `20261008090000_p2_native_sync`. Production does not have that migration yet
(it stays unapproved), so an automatic deploy of P2 code against the P1 schema breaks Production. Verified against a
database with exactly the P1 schema, using the P2 client:

| Operation | Result against the P1 schema |
| --- | --- |
| authenticated user lookup (`requireAuth` selects `deletionRequestedAt`) | fails: column does not exist |
| any `Question` read (new `externalKey`, `archivedAt`) | fails: column does not exist |
| bank lists and session creation (`archivedAt` filter) | fails: column does not exist |
| every attempt write (feed insert into `SyncChange`) | fails: relation does not exist |

So sign-in, banks, sessions and practice would all fail until the migration is applied. The additive migration is safe
for the OLD code (that is how P1 shipped: migrate first, then merge), so the safe order is:

1. restore point, then apply the P2 migration to Production with the guarded workflow (needs the separate cutover approval);
2. verify (counts, `ledger:check`, privileges);
3. merge PR #9 (the automatic deploy is then safe);
4. verify again.

Merging first is not safe. The alternative of merging with a build-skip marker in the merge commit message is not
recommended: it leaves `main` holding code that breaks the next unrelated code push, and its behaviour on this project
was not verified.

## 2. R2 ownership gate (blocks complete web-account deletion; does not block native accounts)

Facts:
- P2 native sync is transcript-only and creates no R2 object. Native accounts have no audio to delete (a test fails if any
  sync or native-auth code touches R2).
- Audio that a database row references (`SessionItem.audioUrl`, `QuizAttempt.audioUrl`, `AttemptEvidence.audioRef`), and the
  study episode files of banks an account owns, are deleted by the account purge through the tested adapter
  (`lib/audio-store.ts`, `lib/native/purge.ts`).
- Existing answer-audio keys are random (`audio/<ms>-<random>.<ext>`) with no owner in the key and no object metadata. Ownership
  exists only through database references.
- Historical and future orphans therefore cannot always be attributed to a user: deleting a bank or session removes the
  referencing rows but not the objects; a slow upload can finish after its row was saved without a reference; an upload
  whose database write fails leaves an object with no row.
- `scripts/cleanup-audio.ts --delete-orphans` is unsafe (it ignores `QuizAttempt` and `AttemptEvidence` references, compares
  URL strings so public-domain URLs look orphaned, and ignores study episodes). The destructive mode is now disabled and
  refuses before reading any environment (test: `__tests__/scripts/cleanup-audio-guard.test.ts`). Its report mode over-reports
  for the same reasons and is a hint only.

Not solved here. Future remediation, in this order, before anyone claims a complete existing-web-user account purge:
1. record ownership at object-write time (an owner id in the key prefix or object metadata, for answer audio and study files);
2. ownership-safe handling of failed and slow uploads (never leave an unreferenced object; delete objects when the
   bank/session/quiz rows that reference them are deleted);
3. a bucket-versus-database inventory (read-only first) that classifies every object as referenced, owned-by-key, or orphaned;
4. an attribution and remediation strategy for historical orphans (attribute by time and the single historical user where
   defensible, otherwise quarantine and delete by policy);
5. only then claim complete web-account deletion.

## 3. Classification of remaining work

Blocking before native Production enablement:
- Sign in with Apple capability configured (docs/P2_APPLE_SETUP.md)
- Apple server-to-server notification endpoint configured and verified
- the iOS repository has a remote and its P2 branch has been reviewed
- a real Apple-token native sign-in test
- a real-device end-to-end sync test against a non-Production environment (docs/P2_NATIVE_E2E_RUNBOOK.md)
- the final Production migration/cutover rehearsal and a separate approval

Blocking complete web-account deletion:
- historical R2 ownership and orphan remediation (section 2)

Non-blocking follow-up:
- background sync

Explicitly outside P2:
- server AI evaluation of iOS attempts (and any entitlement or RevenueCat work)
- P3 FSRS and scheduler authority
- learner feedback
- full content mirroring
- cross-device bank editing

## 4. iOS repository remote (commands for later; nothing has been run)

The iOS work is committed locally on branch `p2/native-sync` (head `afbecb0`) in `~/development/iPrep-ios-p2`, a worktree of the
repository at `~/development/iPrep-ios-clean`. That repository has no remote. When the intended destination is known:

```bash
# 1. add the remote to the main clone (worktrees share it)
git -C ~/development/iPrep-ios-clean remote add origin <REMOTE_URL>

# 2. confirm what is about to be pushed (no secrets, only the P2 commits on top of c2850fa)
git -C ~/development/iPrep-ios-p2 log --oneline c2850fa..p2/native-sync
git -C ~/development/iPrep-ios-p2 ls-files | grep -E "Secrets\.xcconfig$" || echo "no secrets file tracked"

# 3. publish the base first only if the remote is empty, then the branch
git -C ~/development/iPrep-ios-p2 push -u origin main            # only if the remote has no main yet
git -C ~/development/iPrep-ios-p2 push -u origin p2/native-sync

# 4. open the review PR against main
gh pr create --repo <OWNER/REPO> --base main --head p2/native-sync --title "P2: native sync" --body-file <description.md>
```

The other local branches of that repository (`feat/learning-stage1` and friends) are not part of P2 and should not be pushed
as a side effect: push by explicit branch name only.
