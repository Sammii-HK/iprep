# Security boundary

How requests are authenticated and authorised, and what changed in the P0 security work.

## Who can do what

| Caller | Credential | Reaches |
| --- | --- | --- |
| A signed-in human | `auth-token` cookie or a user JWT | Their own data. Admin routes need the stored role `ADMIN`. |
| A machine consumer (MCP server, Notion sync, scripts, a custom GPT) | `Authorization: Bearer ipm_...` | Only the routes whose scope the principal holds, acting as one learner, never as admin. |
| Anyone else | none | `/api/health`, `/api/auth/login`, `/api/auth/logout`, `GET /api/push/subscribe` (the public VAPID key). Nothing else. |

`requireAuth` and `requireAdmin` accept signed-in humans only. A machine token is accepted only by routes that call
`requireAccess(request, '<scope>')`. The old `IPREP_INTERNAL_KEY` / `x-internal-key` (which resolved to the admin user, or
to the first user if `ADMIN_EMAIL` was unset) no longer exists.

## Machine principals

`MachinePrincipal` rows hold the SHA-256 hash of the token (never the token), the learner it acts as, an explicit scope
list, and optional expiry / revocation. Every use is written to `MachineAudit` (including refusals). The learner may be an
admin; the principal still resolves with role `USER`.

Create, list and revoke with `scripts/principals.ts` (dry run unless `--execute`; production needs `--confirm`):

```bash
npx tsx scripts/principals.ts create --target preview --env-file <file> --name notion-sync --email <learner> --execute
```

| Principal (preset) | Scopes | Used by |
| --- | --- | --- |
| `mcp-read` | progress:read, sessions:read, review:read, insights:read, banks:read, folders:read | iPrep MCP server, read tools |
| `mcp-write` | mcp-read + banks:write, folders:write, sessions:write | iPrep MCP server, write tools |
| `notion-sync` | interviews:sync, folders:read | `scripts/sync-notion-interviews.py` |
| `facts-seed` | facts:write | `scripts/seed-fact-sheet.mjs` |
| `audio-tools` | folders:read, banks:read | `build-audio-manifest`, `generate-bank-episodes`, `new-role-folder` (`new-role-folder` also needs folders:write) |

Routes that accept a scope: `GET/POST /api/banks`, `GET /api/banks/[id]` and `/audio` (banks:read / banks:write),
`GET/POST /api/folders`, `POST /api/folders/[id]/banks` (folders:*), `GET/POST /api/sessions`, `GET /api/sessions/[id]`,
`POST /api/sessions/[id]/complete` (sessions:*), `GET /api/user/progress`, `GET /api/study/review`,
`GET /api/learning/insights`, `GET/PUT /api/user/facts`, `POST /api/interviews/sync`.

### Consumers that must be updated before deploying this

The MCP server (`~/development/iprep-mcp`, a separate project) sends `x-internal-key`. After this change it must send the
bearer token instead. The edit is two lines in `src/index.ts`:

```ts
const API_TOKEN = process.env.IPREP_API_TOKEN ?? "";           // was IPREP_INTERNAL_KEY
// headers: { "x-internal-key": INTERNAL_KEY }  ->  headers: { Authorization: `Bearer ${API_TOKEN}` }
```

Its `replace_bank_questions` / `append_bank_questions` tools call `/api/banks/{id}/questions`, a route that exists only in
uncommitted work and is not deployed. The scripts in this repo and the Notion sync already read `IPREP_API_TOKEN`.

## Ownership

One set of rules (`lib/access.ts`), never written as a truthiness check:

- Sessions, quizzes, attempts, folders, progress: the owner only. A row with no owner is an orphan: only an admin may read or
  delete it, to repair it. Analysis and completion are owner-only with no admin path.
- Banks: private banks are for their owner. A bank with no owner is shared content: any signed-in user may read it, only an
  admin may change it. Another learner's private bank is a 404, for everyone including admins.
- Access failures are 404, not 403, so ids cannot be probed.
- `User` deletion is `RESTRICT` on banks, sessions and quizzes, so deleting a user can no longer turn private data into unowned data.

## Registration and login

- Public registration is closed. It opens only with `REGISTRATION_ENABLED=true` **and** a `REGISTRATION_INVITE_CODE`, and the
  caller supplies the code. Every new account is role `USER`; the role is never derived from an email or an env var.
- Emails are stored lowercased and trimmed (`lib/email.ts`), enforced by a database CHECK constraint, so case variants can't
  become second identities.
- Login limits by IP and by account, always runs a bcrypt comparison (dummy hash for unknown accounts), and returns one generic failure.

## Limits

Durable counters in Postgres (`RateLimitBucket`, `lib/rate-limit.ts`): login and registration by IP/account, model-backed
routes (`practice`, `debriefs`, `practice/reanalyze`, `quizzes/attempt`, bank summary) by user (burst and hourly), push by user.
They fail closed (503) if the counter store is unavailable. The client IP comes only from platform headers
(`x-vercel-forwarded-for`, `x-real-ip`), never a client-extendable `X-Forwarded-For`. The AI usage records, per-category and
per-user daily caps and the personalised-audio queue are the later cost-control work (section S of the vNext plan) and reuse these keys.

## Push

Subscriptions must point at a real browser push service (FCM, Mozilla autopush, Apple web push, Windows WNS): https, default
port, no credentials, no IP literals, no look-alike hosts. `POST /api/push/send` is admin-only and its click URL must be a path
inside the app.

## Removed

`/api/env-check` (an unauthenticated route that returned the R2 bucket and endpoint, part of the OpenAI key, and raw database
and storage errors, and made live calls on every request). `/api/health` stays and returns nothing but a status.
