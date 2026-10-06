/**
 * Migration guard: decides whether a migration run is allowed, against which
 * database, and what it may do. Pure functions so every refusal is unit tested.
 *
 * Principles:
 *  - builds never migrate; migrations are an explicit operation on a named target;
 *  - the migration connection (DATABASE_MIGRATION_URL) is separate from the
 *    runtime connection (DATABASE_URL) and is never read implicitly from a file;
 *  - production requires an explicit target, a typed confirmation of the
 *    production endpoint, and a recorded Preview rehearsal of the same migrations.
 */
import { createHash } from 'crypto';
import { classifyDbTarget, describeDbUrl, parseDbUrl } from '../../lib/db-targets';

export type MigrationTarget = 'local' | 'preview' | 'production';

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface Rehearsal {
  hash: string;
  at: string;
  host: string;
}

export interface GuardInput {
  argv: string[];
  env: Record<string, string | undefined>;
  /** Values read from an explicit --env-file, if one was given. */
  fileEnv?: Record<string, string>;
  /** Hash of the prisma/migrations directory contents. */
  migrationsHash: string;
  rehearsals: Rehearsal[];
}

export interface GuardPlan {
  target: MigrationTarget;
  migrationUrl: string;
  description: string;
  statusOnly: boolean;
  notes: string[];
  /** Production apply requires a rehearsal receipt unless explicitly waived. */
  requiresRehearsal: boolean;
  rehearsalWaived: boolean;
}

export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

const CI_CONTEXT_VARS = ['VERCEL', 'VERCEL_ENV', 'CI', 'NEXT_PHASE'] as const;

export function planMigration(input: GuardInput): GuardPlan {
  const { argv, env, fileEnv, migrationsHash, rehearsals } = input;

  const inBuildContext = CI_CONTEXT_VARS.filter((k) => env[k]);
  if (inBuildContext.length > 0 && env.IPREP_ALLOW_CI_MIGRATE !== '1') {
    throw new GuardError(
      `Refusing to run migrations from a build or CI context (${inBuildContext.join(', ')} is set). ` +
        'Migrations are an explicit operation run from a developer machine.'
    );
  }

  const target = flagValue(argv, '--target');
  if (target !== 'local' && target !== 'preview' && target !== 'production') {
    throw new GuardError('Missing or invalid --target. Use --target local, --target preview or --target production. There is no default.');
  }

  // The migration connection comes only from DATABASE_MIGRATION_URL, in the process
  // environment or an explicit --env-file. DATABASE_URL (runtime) is never used.
  const migrationUrl = fileEnv?.DATABASE_MIGRATION_URL ?? env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) {
    throw new GuardError(
      'DATABASE_MIGRATION_URL is not set. Provide it in the environment or with --env-file <path>. ' +
        'The runtime DATABASE_URL is deliberately never used for migrations.'
    );
  }

  const parsed = parseDbUrl(migrationUrl);
  if (!parsed) throw new GuardError('DATABASE_MIGRATION_URL is not a valid postgres connection string.');
  if (parsed.pooled) {
    throw new GuardError('DATABASE_MIGRATION_URL points at a pooled host. Migrations need the direct (non-pooler) connection.');
  }

  const runtimeUrl = env.DATABASE_URL;
  if (target !== 'local' && runtimeUrl && runtimeUrl === migrationUrl) {
    throw new GuardError('The migration connection is identical to the runtime DATABASE_URL. They must be separate credentials.');
  }

  const kind = classifyDbTarget(migrationUrl, env);
  if (target === 'production' && kind !== 'production') {
    throw new GuardError(`--target production but the connection string is not a production database (${describeDbUrl(migrationUrl)}).`);
  }
  if (target === 'preview' && kind !== 'other') {
    throw new GuardError(
      kind === 'production'
        ? `--target preview but the connection string IS the production database (${describeDbUrl(migrationUrl)}). Refusing.`
        : '--target preview but the connection string is a local database. Use --target local.'
    );
  }
  if (target === 'local' && kind !== 'local') {
    throw new GuardError(`--target local but the connection string is not a local database (${describeDbUrl(migrationUrl)}). Refusing.`);
  }

  const notes: string[] = [];
  let statusOnly = argv.includes('--status');
  let requiresRehearsal = false;
  let rehearsalWaived = false;

  if (target === 'production') {
    const endpointId = parsed.endpointId;
    const confirm = flagValue(argv, '--confirm');
    if (confirm !== endpointId) {
      statusOnly = true;
      notes.push(`Production apply requires --confirm ${endpointId} (type the production endpoint id). Showing status only.`);
    }
    requiresRehearsal = true;
    rehearsalWaived = argv.includes('--accept-no-rehearsal');
    const rehearsed = rehearsals.some((r) => r.hash === migrationsHash);
    if (!statusOnly && !rehearsed && !rehearsalWaived) {
      throw new GuardError(
        'These migrations have not been rehearsed on Preview. Run: db:deploy --target preview first, ' +
          'or pass --accept-no-rehearsal to knowingly skip the rehearsal.'
      );
    }
    if (!statusOnly && rehearsalWaived && !rehearsed) notes.push('WARNING: applying to production without a recorded Preview rehearsal.');
  }

  return {
    target,
    migrationUrl,
    description: describeDbUrl(migrationUrl),
    statusOnly,
    notes,
    requiresRehearsal,
    rehearsalWaived,
  };
}

/** A role that cannot create objects in the public schema is a runtime role, not a migration role. */
export function assertMigrationRole(identity: { user: string; canCreateInSchema: boolean }): void {
  if (!identity.canCreateInSchema) {
    throw new GuardError(
      `The role ${identity.user} cannot create objects in the public schema. This looks like a runtime role. ` +
        'Use the migration (schema owner) connection in DATABASE_MIGRATION_URL.'
    );
  }
}

/** Stable hash of the migration files, used to match a Preview rehearsal to a Production run. */
export function hashMigrations(files: Array<{ name: string; content: string }>): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(f.name);
    h.update('\0');
    h.update(createHash('sha256').update(f.content).digest('hex'));
    h.update('\0');
  }
  return h.digest('hex');
}
