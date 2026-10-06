/**
 * The target and credential come only from the process environment (or an explicit
 * --env-file applied by the calling script). Nothing is read implicitly from other
 * tools' config files, so a script never silently targets production.
 */
export function apiConfig(): { base: string; key: string } {
  const base = process.env.IPREP_BASE_URL;
  const key = process.env.IPREP_API_TOKEN;
  if (!base) throw new Error('Missing IPREP_BASE_URL (set it in the environment or pass --env-file <path>)');
  if (!key) {
    throw new Error(
      'Missing IPREP_API_TOKEN: a machine principal token (scripts/principals.ts create). ' +
        'The old IPREP_INTERNAL_KEY (which acted as the admin user) is no longer accepted.'
    );
  }
  return { base: base.replace(/\/$/, ''), key };
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const { base, key } = apiConfig();
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${body === undefined ? 'GET' : 'POST'} ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
