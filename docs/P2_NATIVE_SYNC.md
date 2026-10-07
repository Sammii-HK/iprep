# P2: native identity and sync

> Correctness statement: one authenticated Learner can create spoken-answer evidence on iOS while online or offline,
> retry safely, and later observe the same canonical learning history across devices without duplication or silent loss.

The P1 server ledger stays canonical. iOS never connects to Postgres. Everything crosses an authenticated API. This
file is the contract between server and iOS (section 2) plus the design record. Implementation status is at the end.

## 1. Locked decisions and invariants

- Apple sign-in may create a User and Learner only behind a single-use invite code. Registration stays closed. Existing
  web users link Apple with a one-time link code created while signed in. Never linked by email.
- No server AI evaluation of iOS-synced attempts in P2. A synced attempt is valid history with no evaluation (derived
  state `not_evaluated`); nothing is appended as FAILED or SKIPPED because evaluation did not run. No RevenueCat calls.
- Transcript-only evidence from iOS. No audio upload or retention.
- Server to iOS bank mirroring is deferred. Bundled banks map by stable keys; custom banks are uploaded explicitly.
- Learner feedback (self-grade) is deferred to P3. No FSRS/scheduler state is synced or imported.
- Invariants: server ledger canonical; client never chooses its Learner; client never authors evaluations or
  measurements; retrying an event can never create a second Attempt; uncertain content linkage stays unlinked;
  occurrence time is preserved separately from receipt and feed order; CloudKit is never a second learning authority;
  P0 boundaries and P1 append-only guarantees are unchanged.

## 2. API contract

All sync routes need `Authorization: Bearer <native access token>` (humans only; machine principals and web cookies
are refused). Send `X-iPrep-Client: ios/<version> (<build>)`.

### 2.1 `POST /api/auth/native/apple`
Request:
```json
{ "identityToken": "<Apple JWT>", "nonce": "<raw nonce>", "inviteCode": "IPREP-XXXX-XXXX-XXXX",
  "linkCode": "LINK-XXXX-XXXX", "cancelDeletion": false,
  "device": { "platform": "ios", "appVersion": "1.4.0" } }
```
`nonce` is the raw value; the Apple request must carry `sha256hex(nonce)`. At most one of `inviteCode` / `linkCode`.
Success `200` (existing identity or link) or `201` (account created):
```json
{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900,
  "device": { "id": "..." }, "user": { "id": "..." }, "learner": { "id": "..." } }
```
Errors (stable `code`): `400 INVALID_APPLE_TOKEN`, `403 INVITE_REQUIRED` (missing, invalid, expired or used: one
generic response), `403 LINK_CODE_INVALID`, `403 IDENTITY_REVOKED`, `403 ACCOUNT_DELETION_PENDING` (`purgeAfter`),
`409 ALREADY_LINKED`, `409 SUBJECT_LINKED_ELSEWHERE`, `426 CLIENT_TOO_OLD`, `429`.

### 2.2 `POST /api/auth/native/refresh` / `POST /api/auth/native/logout`
`{ "refreshToken": "..." }` -> `{ accessToken, refreshToken, expiresIn }`. Each refresh token works once; presenting a
rotated one revokes the device (`401 TOKEN_REUSED`). `logout` (Bearer) revokes the device. Other failures `401 INVALID_TOKEN`.

### 2.3 `POST /api/account/apple-link-code` (web, signed in) -> `{ "code": "LINK-...", "expiresAt": "..." }`
### 2.4 `POST /api/account/deletion` (web or native) -> `{ "state": "DELETION_PENDING", "purgeAfter": "..." }`
Revokes every native device immediately and blocks learning writes. Cancel by signing in with Apple and
`cancelDeletion: true` before `purgeAfter`.

### 2.5 `POST /api/sync/events`
```json
{ "deviceClockAtSend": "2026-10-08T09:00:12+01:00",
  "events": [{ "type": "attempt.created", "schemaVersion": 1,
    "eventId": "<uuid, permanent, persisted before submission>",
    "origin": "device",                      // or "legacy-import"
    "surface": "WRITTEN_TO_SPOKEN", "responseMode": "SPOKEN",
    "occurredAt": "2026-10-07T18:41:03+01:00",
    "prompt": { "text": "<snapshot, required>", "questionId": null, "questionRevisionId": null,
                "clientRef": { "bankKey": "communication", "questionKey": "comm-1" },
                "type": "BEHAVIORAL", "tags": ["leadership"] },
    "evidence": { "transcript": "...", "transcriber": "apple-sfspeech", "words": 142, "durationMs": 61000,
                  "fillerCount": 4, "longPauses": 1 },
    "evaluationRequested": true }] }
```
At most 50 events. Response (each event is its own transaction):
```json
{ "results": [{ "eventId": "...", "status": "created|duplicate|conflict|rejected|retry",
    "attemptId": "...", "linkage": "linked|unlinked", "evaluation": { "state": "not_evaluated" }, "code": null }],
  "serverTime": "..." }
```
`retry` means a transient server failure for that event: nothing was written, resend it unchanged (back off).
Same `eventId` + same canonical payload -> `duplicate` (existing attempt). Same `eventId` + different payload ->
`conflict` (`EVENT_ID_CONFLICT`). The server computes the payload hash itself. Anything outside this schema, any
`learnerId`, evaluation or measurement field -> `rejected`. Clock fields never rewrite `occurredAt`.

### 2.6 `GET /api/sync/changes?cursor=<opaque|empty>&limit=<=100`
```json
{ "changes": [{ "entityType": "attempt", "entityId": "...", "kind": "upsert", "data": { /* AttemptView */ } }],
  "nextCursor": "<opaque>", "hasMore": false, "epoch": 1, "serverTime": "..." }
```
`AttemptView`: `id, clientEventId, source, surface, responseMode, occurredAt, recordedAt, occurredAtSuspect,
prompt{text,questionId,questionRevisionId,type,tags,bankId}, contentLinkage, evidence{transcript,responseText,
transcriber,words,wpm,fillerCount,fillerRate,longPauses}, evaluation{state: not_evaluated|evaluated|evaluation_failed,
evaluations:[{id,kind,status,evaluatorVersion,evaluatedAt,measurements:[...]}]}`. Store `nextCursor` after each page is
applied. No cursor expires; `409 EPOCH_CHANGED {epoch}` means discard the cursor and pull from the start (idempotent).

### 2.7 `POST /api/sync/banks/import`
```json
{ "bankKey": "custom-<uuid>", "title": "My bank",
  "questions": [{ "questionKey": "q-<uuid>", "text": "...", "hint": null, "tags": [], "difficulty": 3 }] }
```
-> `{ "bankId": "...", "created": true, "questions": [{ "questionKey": "...", "questionId": "...",
"revisionId": "...", "status": "created|existing|text_differs" }] }`. Idempotent by `bankKey`; never edits existing text.

## 3. Design record (summary)

Identity: `User -> Learner` (P1) plus `AuthIdentity`, `Device`, rotating `NativeRefreshToken`s. Native access tokens
use a separate signing key and audience from the web cookie JWT, so neither authenticates in the other's context.
Content: `Question` ids are stable; edits add immutable `QuestionRevision`s (recorded by a database trigger, so no code
path can forget); `externalKey` only maps client keys. An attempt is `linked` only when its snapshot equals a retained
revision; otherwise `unlinked` with the client's references kept. Feed: `SyncChange(txid, id)` with a
transaction-horizon pull (see docs/P2_CURSOR_PROOF.md).

## 4. Behaviour notes added during implementation

- **Legacy import of a known event is a duplicate.** `origin: legacy-import` for an event id the ledger already holds
  returns `duplicate` even if its payload is thinner than the original; the first writer's record stands and the import
  never overwrites. A NEW event reusing an id with different content is still a `conflict`.
- **Bank-only legacy references.** A legacy record that only knows its bank (`clientRef.bankKey`, no `questionKey`)
  links when exactly one question in that bank has ever said exactly this text; zero or several matches stays unlinked.
  This is migration machinery, not a permanent identity.
- **Linkage never leaks.** Linking requires the learner to be able to read the bank (their own, or an unowned shared
  one); the private facts bank is never linked; two candidate banks for one key is uncertainty (unlinked).
- **Evaluation.** Nothing evaluates a synced attempt in P2 and no FAILED or SKIPPED row is created for that. The pull
  reports `not_evaluated` until some evaluation exists (for example one appended by existing web behaviour).
- **Idempotency scope.** `UNIQUE (learnerId, clientEventId)`: another learner reusing an id neither collides nor sees it.
- **Deletion-pending accounts** are refused by `requireAuth` (web), `requireDevice` (native) and machine access.

## 5. Account lifecycle and the purge

`POST /api/account/deletion` marks the account DELETION_PENDING, revokes every native device immediately and records
`purgeAfter` = request + 30 days (asking again does not extend it). The purge itself is `scripts/purge-accounts.ts`
with the OWNER credential (never the runtime role): it refuses until the grace period has ended, and runs in one
transaction that opts in to maintenance (`SET LOCAL iprep.ledger_maintenance = 'on'`, honoured by the append-only
triggers for that transaction only). It deletes every row that can identify or reproduce the learner (attempts,
transcripts, prompt snapshots, evaluations, measurements, legacy session items and quiz attempts, sessions, owned banks
and their questions and revisions, progress, insights, goals, interviews, folders, machine principals, devices,
tokens, identities, link codes, sync feed and log, rate-limit rows keyed by their id, the learner and the user),
nulls the invite redemption, and leaves a receipt with row counts only. R2 audio objects cannot be deleted from SQL:
the script lists their keys and, given `--delete-audio --r2-env-file`, deletes them (that R2 path is not covered by
automated tests; no real bucket is touched in tests). It has been tested for refusal paths, isolation from other
learners, atomicity and leakage, and has NOT been run against any real account.

### R2 ownership audit (what an account purge can and cannot delete)

Audio lives in one bucket under the `audio/` prefix. Ownership exists only through database rows:

| Object | Key | Owner trail | Purge |
| --- | --- | --- | --- |
| Web practice/quiz answer audio | `audio/<ms>-<random>.<ext>` (no owner in the key, no object metadata) | `SessionItem.audioUrl`, `QuizAttempt.audioUrl`, `AttemptEvidence.audioRef` | deleted (keys extracted from those rows) |
| Generated study episode of a bank | `audio/study/<bankId>.mp3`, `.txt`, `.json` | the bank's owner | deleted for every bank the account owns |
| Shared manifest | `audio/study/manifest.json` | none (shared) | never deleted (refused by the adapter) |
| **Orphans**: no row references them | same random keys | **none** | **cannot be found** |

**The gap, exactly.** An answer-audio object is attributable only while a row references it. Three existing paths leave
objects with no trail: (1) deleting a bank or a session deletes the `SessionItem`/`QuizAttempt` rows (including their
`audioUrl`) without deleting the R2 object; (2) in `POST /api/practice` the row is saved after waiting at most 10 seconds
for the upload, so a slower upload completes after the row was written with a null `audioUrl`; (3) an upload whose later
database write fails. Historical orphans of these kinds exist in the bucket today and no ownership can be reconstructed
for them. `scripts/cleanup-audio.ts --delete-orphans` is not a substitute: it matches only `SessionItem.audioUrl` against
the endpoint URL form, so it would treat quiz audio, `AttemptEvidence` audio and public-domain URLs as orphans.

What is proven (tests): the keys derived from every referencing row plus owned banks' study files are deleted through
the `lib/audio-store.ts` adapter (tested against a fake: complete runs, partial failure reported and never called
complete, refusal of foreign prefixes, path tricks and the shared manifest, idempotent re-run); the adapter and the old
cleanup script are the only code that deletes R2 objects; no sync or native-auth code touches R2.

What is NOT proven or possible today: complete deletion of every object a person's audio ever created on the web. For
accounts created through native sign-in this does not matter, because P2 is transcript-only: they never create an R2
object (a test fails if any sync or native code imports R2). It does matter for web accounts that recorded audio. **Real
account creation and any web account purge stay gated on closing this**: record ownership at write time (an owner id in the
object key or metadata, and delete R2 objects in the bank/session delete paths) and run an inventory of the bucket against
the database to size the historical orphans. That change is not in P2.

Ambiguities reported, not decided: whether truly aggregate counters elsewhere (for example admin statistics derived from
tables) may persist (none are stored today); whether backups (Neon restore branches) containing a purged learner must
be rotated out on a schedule (they are retained deliberately for rollback); R2 retention beyond the explicit delete.

## 6. Operations

- Invites: `npx tsx scripts/native-invites.ts create|list --target <t> --env-file <file> [--execute]`.
- Catalog: `npx tsx scripts/publish-catalog.ts --target <t> --env-file <file> --catalog <bundled-catalog.json> [--execute]`
  publishes the bundled iOS banks as unowned shared banks keyed by their existing slugs.
- Diagnostics: `npx tsx scripts/sync-inspect.ts --target <t> --env-file <runtime env> --user <id> [--event <eventId>]`.
- Epoch: `scripts/sync-epoch.ts` (see docs/P2_CURSOR_PROOF.md).
- Purge: `scripts/purge-accounts.ts list|purge`.
- Minimum client: set `NATIVE_MIN_CLIENT_BUILD` to refuse older builds with 426 `CLIENT_TOO_OLD`.
- Apple audience: `APPLE_CLIENT_ID` (defaults to the bundle id `app.lunary.iprep`).

## 7. Manual actions (Apple Developer account) before real accounts are created

Not needed for the server dark launch, the test learner or Preview database work. REQUIRED before the TestFlight
cohort or any broad native account creation. I cannot do these and have not tried to.

1. **Sign in with Apple capability.** developer.apple.com > Certificates, Identifiers & Profiles > Identifiers >
   `app.lunary.iprep` > enable Sign in with Apple (primary App ID). Regenerate and download the provisioning profile
   (or let Xcode manage signing). The entitlement is already in the repo.
2. **Server-to-server notification endpoint.** In the same Identifier, Sign in with Apple > Edit > set the
   *Server to Server Notification Endpoint* to `https://<production host>/api/auth/native/apple/notifications`
   (Apple requires HTTPS). The route verifies Apple's signed JWT; there is no shared secret to configure. Apple sends
   `consent-revoked` and `account-delete` events there. (If sign-in must also work for a web Services ID, that is a
   separate Services ID; P2 uses the app's bundle id only.)
3. Confirm `APPLE_CLIENT_ID` in Vercel Production is unset (default `app.lunary.iprep`) or set to the bundle id exactly.
4. Generate invites on the target environment with `scripts/native-invites.ts` and hand them to testers.

## 8. Rollback

`docs/p2-rollback.sql` (owner, by hand) restores exactly the P1 schema and leaves the P1 ledger and legacy tables
untouched (tested, chained before the P1 rollback). Users created through Apple sign-in remain as ordinary users with
their learners and attempts but lose their Apple sign-in. Canonical attempts written by the sync are never deleted by a
rollback.

## 9. Implementation status

See the PR description for the verification record and what remains. Out of P2 by decision: server AI evaluation of
iOS attempts, RevenueCat entitlement, bank mirroring, two-way bank editing, audio, learner feedback, FSRS and any
scheduler, CloudKit teardown.
