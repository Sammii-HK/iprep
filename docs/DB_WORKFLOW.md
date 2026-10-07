# Database workflow

Builds never migrate databases. A production migration is an explicit operation against a clearly
identified target, run from a developer machine with a separate migration credential.

## Environments

| Environment | Runtime connection (`DATABASE_URL`) | Migration connection (`DATABASE_MIGRATION_URL`) |
| --- | --- | --- |
| Production | Neon production branch, **runtime role** (application reads and writes, no DDL). Target state; today it is still the owner role, see "Production role transition". | Schema owner, direct (non-pooler) host. **Never in Vercel.** Local file only. |
| Preview | Neon `preview` branch, runtime role (`preview_app` today). | A branch-local owner. **Never in Vercel.** Local file only. |
| Development | Local Postgres | The same local database |

- Production, Preview and Development have different databases, different JWT secrets and no shared R2 or AI credentials. Preview and Development hold inert placeholders for R2 and OpenAI.
- `lib/db.ts` refuses to start if a preview or development process is configured with the production database (`lib/db-targets.ts`).
- Prisma: the running client uses `DATABASE_URL`; the Prisma CLI (migrate) uses `directUrl = DATABASE_MIGRATION_URL`. `prisma generate` and `next build` need neither the migration variable nor schema ownership.

## Commands

```bash
# Local
pnpm db:migrate --name add_thing                       # prisma migrate dev, local target only (add --create-only to review the SQL first)
pnpm db:status  --target local
pnpm db:deploy  --target local

# Preview rehearsal (records a receipt for this exact set of migrations)
pnpm db:status  --target preview --env-file ~/.config/iprep/preview-migrate.env
pnpm db:deploy  --target preview --env-file ~/.config/iprep/preview-migrate.env

# Production (shows status only until you type the production endpoint id)
pnpm db:deploy  --target production --env-file ~/.config/iprep/production-migrate.env
pnpm db:deploy  --target production --env-file ~/.config/iprep/production-migrate.env --confirm <endpoint-id>
```

What the guard checks (`scripts/db/guard.ts`, covered by `__tests__/scripts/db-guard.test.ts`):

- `--target` is required. There is no default.
- The connection comes only from `DATABASE_MIGRATION_URL` (environment or an explicit `--env-file`). The runtime `DATABASE_URL` is never used and no env file is loaded implicitly.
- The target must match the connection: `production` needs the production Neon endpoint, `preview` refuses it, `local` needs localhost.
- The migration connection must be the direct host and must not equal the runtime `DATABASE_URL`.
- It refuses to run from Vercel, a build, or CI.
- The role must be able to create objects in `public` (a runtime role is refused).
- Production applies only with `--confirm <endpoint-id>` and only for migrations whose exact contents were rehearsed on Preview (`.db-rehearsals.json`, local, git-ignored). `--accept-no-rehearsal` skips the rehearsal knowingly and prints a warning.

Credentials live in files outside the repo (for example `~/.config/iprep/*.env`, mode 600), not in
Vercel and not in `.env.production.local`.

## Safe migration workflow

1. Write the migration locally (`pnpm db:migrate`). Prefer additive, backwards-compatible changes: add, backfill, then in a later release remove.
2. Review the generated SQL in `prisma/migrations/`. Never edit an applied migration.
3. Rehearse on Preview: `pnpm db:deploy --target preview ...`. Exercise the app against the Preview branch.
4. Before production, take a restore point. Neon's point-in-time restore window on the Launch plan is 6 hours; for a risky change create a Neon branch from `main` first (a named, temporary backup branch) and delete it afterwards.
5. Apply to production with the guarded command and `--confirm`.
6. Deploy the application code that needs the migration **after** the migration is applied. Builds do not migrate.

Never run `prisma db push` against a shared database and never use a raw SQL file outside
`prisma/migrations`. The old `db:push` script, the root `migration.sql` and `MIGRATION_INSTRUCTIONS.md`
were removed because they described exactly that.

## Runtime and migration roles

Neon console-created roles are members of `neon_superuser` (CREATEROLE, CREATEDB, BYPASSRLS), which is far more than a
runtime needs. The target runtime role is created with SQL and holds only:

```sql
CREATE ROLE iprep_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT CONNECT ON DATABASE neondb TO iprep_app;
GRANT USAGE ON SCHEMA public TO iprep_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO iprep_app;
REVOKE ALL ON TABLE _prisma_migrations FROM iprep_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO iprep_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO iprep_app;   -- present on Production and Preview; a fresh environment needs it too
```

Sequences are not covered by the table grant. Until P2 no table used one; `SyncChange` does. The P2 migration therefore also
grants the runtime role `USAGE, SELECT` on `SyncChange_id_seq` explicitly, so it does not depend on the default above, and
it revokes the runtime role's UPDATE/DELETE/TRUNCATE on the ledger, the feed, the diagnostic log, revisions and receipts
(the epoch is read-only for it). `__tests__/db/runtime-privileges.integration.test.ts` audits the exact matrix.

This was proven against a throwaway local database: nested creates, includes and interactive
transactions work; create table, alter table, reading `_prisma_migrations` and creating roles are denied.
`__tests__/db/runtime-role.integration.test.ts` repeats that proof (`pnpm test:db`, needs a local Postgres).

### Production role transition (not done yet; needs explicit approval)

Production still uses the owner role for the application. Moving it to a runtime role is a Production
infrastructure change, done only after the restricted role has been proven against the real application on
Preview: create the role, switch Production `DATABASE_URL`, remove the owner-level variables
(`DATABASE_URL_UNPOOLED` and the `PG*` / `POSTGRES_*` ones) from Vercel, deploy, verify. Rollback is restoring the
previous `DATABASE_URL` (kept in the local migration file).

## Scripts that can change data

No script loads `.env.production.local`. Scripts that write to the database, R2 or the live API need
`--target local|preview|production` and an explicit `--env-file`; the resources must match the target; production
needs `--confirm <identity>` (`scripts/lib/target.ts`). Destructive scripts (`cleanup-audio`, the seeds)
are dry runs unless `--execute`. `cleanup-audio --execute` also needs `--expect-delete <N>` with the count from the dry run.

## Known drift

Production has a `QuestionBank.audioUrl` column that is in no migration and not in `schema.prisma`. It came from the
April 2026 podcast pipeline v1 (`generate_podcasts.ts`, now retired), was applied with `db push`, holds no data and is
read by no code. It is deliberately left alone: `prisma migrate diff` reports it, and it is harmless.

## Configuration debt (recorded, not fixed here)

Optional capabilities currently have to be configured with fake values just to boot (`getConfig` requires all R2
variables, `OPENAI_API_KEY`, `ADMIN_EMAIL`, `JWT_SECRET` at runtime on Vercel). Preview and Development therefore hold
inert placeholders. R2, the AI providers and `ADMIN_EMAIL` should become genuinely optional capabilities. Also,
`getConfig` treats `NODE_ENV=production` without `VERCEL` as build time and relaxes validation, which would hide
missing variables on a self-hosted production host. Both are a later configuration-boundary improvement.
