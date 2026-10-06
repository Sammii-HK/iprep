/**
 * Database target classification.
 *
 * One place that answers "which database is this connection string, and is the
 * running environment allowed to use it?". Used by the runtime client (so a
 * preview or development process can never connect to production) and by the
 * migration and script guards (so production is never an implicit target).
 *
 * Hostnames are identifiers, not credentials. The production Neon compute
 * endpoint is listed here on purpose so the check cannot be defeated by a
 * missing environment variable.
 */

export type DbEnvironment = 'production' | 'preview' | 'development';
export type DbTargetKind = 'production' | 'local' | 'other';

/** Neon compute endpoint ids that belong to production (pooled and direct hosts share the id). */
export const PRODUCTION_DB_ENDPOINTS: readonly string[] = ['ep-dawn-sun-ahkhrdkl'];

export interface ParsedDbUrl {
  host: string;
  endpointId: string;
  user: string;
  database: string;
  pooled: boolean;
}

export function parseDbUrl(url: string | undefined | null): ParsedDbUrl | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    const firstLabel = host.split('.')[0];
    const pooled = firstLabel.endsWith('-pooler');
    const endpointId = pooled ? firstLabel.slice(0, -'-pooler'.length) : firstLabel;
    return {
      host,
      endpointId,
      user: decodeURIComponent(u.username),
      database: u.pathname.replace(/^\//, ''),
      pooled,
    };
  } catch {
    return null;
  }
}

function productionEndpoints(env: Record<string, string | undefined>): string[] {
  const extra = (env.IPREP_PRODUCTION_DB_ENDPOINTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...PRODUCTION_DB_ENDPOINTS, ...extra];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function classifyDbTarget(
  url: string | undefined | null,
  env: Record<string, string | undefined> = process.env
): DbTargetKind {
  const parsed = parseDbUrl(url);
  if (!parsed) return 'other';
  if (productionEndpoints(env).includes(parsed.endpointId)) return 'production';
  if (LOCAL_HOSTS.has(parsed.host)) return 'local';
  return 'other';
}

/** Which environment this process is running in. Vercel sets VERCEL_ENV; elsewhere use IPREP_ENV. */
export function currentEnvironment(env: Record<string, string | undefined> = process.env): DbEnvironment {
  const explicit = env.VERCEL_ENV ?? env.IPREP_ENV;
  if (explicit === 'production' || explicit === 'preview' || explicit === 'development') return explicit;
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

/**
 * Throws if a non-production environment is configured with a production database.
 * Defence in depth: environment isolation is done in the hosting configuration,
 * and this makes a misconfiguration fail loudly instead of mutating production.
 */
export function assertRuntimeDbAllowed(
  url: string | undefined | null,
  env: Record<string, string | undefined> = process.env
): void {
  if (!url) return;
  const environment = currentEnvironment(env);
  if (environment !== 'production' && classifyDbTarget(url, env) === 'production') {
    throw new Error(
      `Refusing to start: the ${environment} environment is configured with a production database. ` +
        'Use the preview or local database for non-production environments.'
    );
  }
}

/** Redacted description safe to print: host and role, never the password. */
export function describeDbUrl(url: string | undefined | null): string {
  const p = parseDbUrl(url);
  if (!p) return '(unparseable or missing connection string)';
  return `${p.user}@${p.host}/${p.database}${p.pooled ? ' (pooled)' : ''}`;
}
