# P2 native end-to-end runbook (first real-device test, NON-Production)

Not executed yet. Run it only after the Apple capability is enabled (docs/P2_APPLE_SETUP.md) and the iOS code has a remote and
has been reviewed. Environment: **Preview**. Every step records evidence (ids and counts), not impressions.

## 0. Setup

1. The Preview database already has the P2 migration (applied through the guarded workflow). Confirm:
   `pnpm db:status --target preview --env-file ~/.config/iprep/preview-migrate.env` shows no pending migration.
2. Deploy the P2 code to a Preview URL. The branch push alone is skipped by the Ignored Build Step, so deploy the branch tree
   with the Vercel CLI as a Preview deployment (never `--prod`): `vercel deploy` from a clean checkout of the P2 branch. Note the
   URL. If the deployment is behind Vercel Deployment Protection, the app's requests will be refused: use the project's
   protection bypass for this test (do not turn protection off).
3. Publish the catalog (once): `npx tsx scripts/publish-catalog.ts --target preview --env-file ~/.config/iprep/preview-runtime.env --catalog <iOS repo>/docs/bundled-catalog.json --execute`.
4. Create three invites: `npx tsx scripts/native-invites.ts create --target preview --env-file ~/.config/iprep/preview-runtime.env --count 3 --note "e2e" --execute`. Keep the codes; they print once.
5. Build the iOS app to the device with sync enabled and the base URL pointed at the Preview URL (launch argument
   `-iprepSyncBaseURL https://<preview url>` or the `IPREP_SYNC_BASE_URL` build setting; the debug toggle in Settings turns sync on).
6. Have two Apple IDs: A (the main tester) and B (a second one), plus a second install target (second device, or a clean simulator).
7. Evidence helpers (read-only, run against Preview):
   - counts: `npx tsx scripts/sync-inspect.ts --target preview --env-file ~/.config/iprep/preview-runtime.env --user <userId>`
   - one event: add `--event <eventId>`
   - integrity: `pnpm ledger:check --target preview --env-file ~/.config/iprep/preview-runtime.env` (must stay 7 of 7)
   - baseline: record `SELECT count(*) FROM "User"`, `"Learner"`, `"Attempt"`, `"AttemptEvaluation"`, `"AttemptMeasurement"`, `"AuthIdentity"`, `"Device"` before you start.

## 1. Identity

| Step | Expected | Evidence |
| --- | --- | --- |
| Sign in as A with invite 1 | exactly one new User, one Learner, one AuthIdentity, one Device; 201 | the ids and the +1 counts |
| Sign in as A again on the same install | same User and Learner; no new User | counts unchanged for User and Learner |
| Try to sign in as B with no invite (a fresh Apple ID) | refused with the generic "invitation required"; no User created | User count unchanged |
| Force a token refresh (let the access token expire, or call refresh) | new access and refresh token; the old refresh token no longer works | the Device `lastSeenAt`; replay of the old token returns 401 |
| Use A's native access token against a web route (`GET /api/banks`) | 401 | status |
| Use a web session token against `GET /api/sync/changes` | 401 | status |
| Use a machine token against `/api/sync/events` | 401 | status |

## 2. Online attempt

1. On A's phone answer one question (written prompt, spoken answer). Note the question text and the time.
2. Local: the PracticeSession exists; the outbox shows the same UUID (Account and sync screen: pending count then zero).
3. Server: exactly one Attempt with `clientEventId` = that UUID, `source = ios-sync`, `surface = WRITTEN_TO_SPOKEN`,
   evidence transcript = what was said, `transcriber = apple-sfspeech`.
4. No evaluation and no measurement for it (`AttemptEvaluation`/`AttemptMeasurement` counts unchanged); the app shows
   "not evaluated", never a server score.
5. Pull: the synced-history list shows it once.

## 3. Duplicate and lost response

- Replay the exact event body to `POST /api/sync/events` with A's token (capture it from the app's diagnostics, or with
  `curl`): response `duplicate`, same `attemptId`; Attempt count unchanged.
- Lost response: put the phone in a state where the server commits but the reply is dropped (airplane mode toggled right
  after the request leaves, or kill the app after sending). Reopen: the app retries; result `duplicate`; still one Attempt.

## 4. Offline

1. Airplane mode on. Answer a question. Kill the app. Reopen (still offline).
2. The local session and the outbox row survive (pending count 1). Nothing was sent.
3. Airplane mode off, foreground the app (or Retry now). The same UUID syncs once; the pending count returns to zero;
   exactly one Attempt exists; `occurredAt` is the offline time, `recordedAt` is later (record both).

## 5. Another device

Sign in as A on the second install (invite not needed). Cursor zero pull: the history list matches the server's attempt
count for that learner (record the count on both). Kill the app mid-pull if you can; reopen; it resumes without duplicates.

## 6. Web and native converge

1. Create a normal web attempt as A's web identity (link A first with a link code if A has no web login: `POST /api/account/apple-link-code`
   from a signed-in web session, enter the code in the app). Record its attempt id.
2. The phone pulls it (shown with its source). 3. Create a native attempt; the server and the web history show it.
4. `SELECT count(*) FROM "Learner" WHERE "userId" = <A>` is 1 throughout.

## 7. Question revision

Answer a bundled question after the server edited it (edit via the identity-preserving route, which creates revision 2) while the
phone still shows the old text, offline. After sync: the Attempt is `linked` to the retained revision 1 (check
`questionRevisionId`), or `unlinked` with the snapshot kept. It must never reference revision 2's text.

## 8. Wrong account

1. As A, go offline, answer (outbox row tagged A). 2. Sign out. 3. Sign in as B (invite 2), go online. 4. A's event is **not**
sent: no Attempt for that UUID under B's learner; it is still pending for A. 5. Sign back in as A: it sends once.

## 9. Legacy import

1. On a device with a known small history (for example 5 practice records, including one created on another device and
   delivered by CloudKit), choose the import. 2. The confirmation names the account and the count and says transcripts
   are uploaded. 3. After import: exactly 5 Attempts with `source = ios-legacy-import`; transcript, prompt and time only;
   `AttemptEvaluation` and `AttemptMeasurement` counts unchanged (no score became either). 4. Run the import again: counts
   unchanged. 5. The CloudKit-delivered record appears once.

## 10. Security and regression

- Registration stays closed: `POST /api/auth/register` without an invite is refused as before.
- Machine principals still scoped (`audio-tools` refused on sessions, and so on, as in the P0 checks).
- `ledger:check` still 7 of 7; no owner credential in Vercel Preview environment variables (`vercel env ls preview` shows only the runtime
  `DATABASE_URL`).
- Optional: request deletion on a THROWAWAY test account (never a real one) and confirm sign-in is blocked and the purge date is
  30 days out. Do not run the purge.

## 11. Evidence record

Fill in: environment URL and commit, the three invite ids (not codes), User/Learner/Device/Attempt ids, event UUIDs, and the
before/after counts for every step above, then attach the `sync-inspect` output. The run passes only if every row meets its
expected result with ids and counts recorded.
