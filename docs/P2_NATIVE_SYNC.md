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
Content: `Question` ids are stable; edits add immutable `QuestionRevision`s; `externalKey` only maps client keys.
An attempt is `linked` only when its snapshot equals a retained revision; otherwise `unlinked` with the client's
references kept. Feed: `SyncChange(txid, id)` with a transaction-horizon pull (see docs/P2_CURSOR_PROOF.md).

