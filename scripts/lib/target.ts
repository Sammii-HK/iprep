/**
 * Explicit targeting for scripts that can mutate the database, R2 or the live API.
 *
 * Rules:
 *  - production is never an implicit target and no env file is ever loaded implicitly;
 *  - a mutating script needs `--target local|preview|production`;
 *  - the resources the script would touch (database, R2 bucket, API host) must all
 *    agree with that target, so a production bucket with a preview database is refused;
 *  - production needs `--confirm <identity>` typed by the operator;
 *  - destructive operations default to a dry run and need `--execute`.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { classifyDbTarget, describeDbUrl, parseDbUrl } from '../../lib/db-targets';

export type ScriptTarget = 'local' | 'preview' | 'production';

export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetError';
  }
}

/** Public identifiers of production resources (not credentials). */
export const PRODUCTION_R2_BUCKETS: readonly string[] = ['iprep-bucket'];
export const PRODUCTION_API_HOSTS: readonly string[] = ['iprep-five.vercel.app'];

export interface TargetOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  uses: { db?: boolean; r2?: boolean; api?: boolean };
  /** The script writes or deletes something. Read-only scripts only print their target. */
  mutating: boolean;
  /** Irreversible (deletes objects or rows): needs --execute, default is a dry run. */
  destructive?: boolean;
}

export interface ResolvedTarget {
  target: ScriptTarget | 'unspecified';
  dryRun: boolean;
  lines: string[];
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

/** The only way environment files are loaded: an explicit --env-file. Returns the values read. */
export function loadExplicitEnvFile(argv: string[]): Record<string, string> {
  const path = flag(argv, '--env-file');
  if (!path) return {};
  return parseDotenv(readFileSync(resolve(path)));
}

type Kind = 'production' | 'local' | 'other';

function apiKind(base: string | undefined): Kind {
  if (!base) return 'other';
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (PRODUCTION_API_HOSTS.includes(host)) return 'production';
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
  } catch {
    // fall through
  }
  return 'other';
}

function r2Kind(bucket: string | undefined, env: Record<string, string | undefined>): Kind {
  if (!bucket) return 'other';
  const extra = (env.IPREP_PRODUCTION_R2_BUCKETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...PRODUCTION_R2_BUCKETS, ...extra].includes(bucket) ? 'production' : 'other';
}

function matches(target: ScriptTarget, kind: Kind): boolean {
  if (target === 'production') return kind === 'production';
  if (target === 'local') return kind === 'local';
  return kind === 'other'; // preview: neither production nor local
}

export function resolveScriptTarget(opts: TargetOptions): ResolvedTarget {
  const { argv, env, uses, mutating, destructive } = opts;
  const lines: string[] = [];
  const resources: Array<{ label: string; kind: Kind; identity: string }> = [];

  if (uses.db) {
    const url = env.DATABASE_URL;
    const parsed = parseDbUrl(url);
    resources.push({ label: `database ${describeDbUrl(url)}`, kind: classifyDbTarget(url, env), identity: parsed?.endpointId ?? '' });
  }
  if (uses.r2) {
    const bucket = env.R2_BUCKET_NAME;
    resources.push({ label: `R2 bucket ${bucket ?? '(unset)'}`, kind: r2Kind(bucket, env), identity: bucket ?? '' });
  }
  if (uses.api) {
    const base = env.IPREP_BASE_URL;
    let host = '';
    try {
      host = base ? new URL(base).hostname : '';
    } catch {
      host = '';
    }
    resources.push({ label: `API ${host || '(unset)'}`, kind: apiKind(base), identity: host });
  }

  for (const r of resources) lines.push(`${r.kind === 'production' ? 'PRODUCTION' : r.kind.toUpperCase()}  ${r.label}`);

  const targetFlag = flag(argv, '--target');
  const target = targetFlag === 'local' || targetFlag === 'preview' || targetFlag === 'production' ? targetFlag : undefined;
  if (targetFlag && !target) throw new TargetError(`Invalid --target "${targetFlag}". Use local, preview or production.`);

  if (!target) {
    if (mutating) {
      throw new TargetError(
        'This script can change data. Pass --target local|preview|production. There is no default, and no .env file is loaded implicitly (use --env-file <path>).\n' +
          (lines.length ? `Resources it would use:\n  ${lines.join('\n  ')}` : '')
      );
    }
    return { target: 'unspecified', dryRun: false, lines };
  }

  for (const r of resources) {
    if (!matches(target, r.kind)) {
      throw new TargetError(`--target ${target} but ${r.label} is ${r.kind === 'other' ? 'not a ' + target : r.kind} resource. Refusing a mixed or mistaken target.`);
    }
  }

  if (target === 'production' && mutating) {
    const identity = resources[0]?.identity;
    const confirm = flag(argv, '--confirm');
    if (!identity || confirm !== identity) {
      throw new TargetError(`Production needs --confirm ${identity || '<identity>'} (type the production ${resources[0]?.label.split(' ')[0] ?? 'resource'} identity).`);
    }
  }

  const dryRun = Boolean(destructive) && !argv.includes('--execute');
  return { target, dryRun, lines };
}

/** Print the target block at the start of every script run. */
export function printTarget(name: string, r: ResolvedTarget): void {
  console.log(`${name}`);
  console.log(`  Target: ${r.target}`);
  for (const l of r.lines) console.log(`  ${l}`);
  if (r.dryRun) console.log('  Mode: DRY RUN (nothing will be changed). Pass --execute to apply.');
  console.log('');
}
