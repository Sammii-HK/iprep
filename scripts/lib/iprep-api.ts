import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function apiConfig(): { base: string; key: string } {
  let base = process.env.IPREP_BASE_URL;
  let key = process.env.IPREP_INTERNAL_KEY;
  if (!base || !key) {
    const claudeJson = join(homedir(), '.claude.json');
    if (existsSync(claudeJson)) {
      const env = JSON.parse(readFileSync(claudeJson, 'utf8'))?.mcpServers?.iprep?.env ?? {};
      base = base || env.IPREP_BASE_URL;
      key = key || env.IPREP_INTERNAL_KEY;
    }
  }
  if (!base) throw new Error('Missing IPREP_BASE_URL (env or ~/.claude.json mcpServers.iprep.env)');
  if (!key) throw new Error('Missing IPREP_INTERNAL_KEY (env or ~/.claude.json mcpServers.iprep.env)');
  return { base: base.replace(/\/$/, ''), key };
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const { base, key } = apiConfig();
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-internal-key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${body === undefined ? 'GET' : 'POST'} ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
