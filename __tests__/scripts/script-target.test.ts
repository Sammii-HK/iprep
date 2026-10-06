import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { TargetError, resolveScriptTarget } from '../../scripts/lib/target';

const PROD_DB = 'postgresql://o:pw@ep-dawn-sun-ahkhrdkl.c-3.us-east-1.aws.neon.tech/neondb';
const PREVIEW_DB = 'postgresql://o:pw@ep-winter-water-ahz8kwcg.c-3.us-east-1.aws.neon.tech/neondb';
const PROD_ENV = { DATABASE_URL: PROD_DB, R2_BUCKET_NAME: 'iprep-bucket', IPREP_BASE_URL: 'https://iprep-five.vercel.app' };

describe('scripts never target production implicitly', () => {
  it('a mutating script without --target is refused', () => {
    expect(() => resolveScriptTarget({ argv: [], env: PROD_ENV, uses: { db: true }, mutating: true })).toThrow(TargetError);
  });

  it('a read-only script runs without a target but reports its target', () => {
    const r = resolveScriptTarget({ argv: [], env: PROD_ENV, uses: { db: true }, mutating: false });
    expect(r.target).toBe('unspecified');
    expect(r.lines.join(' ')).toMatch(/PRODUCTION/);
  });

  it('production needs --confirm with the endpoint id, bucket or host', () => {
    expect(() => resolveScriptTarget({ argv: ['--target', 'production'], env: PROD_ENV, uses: { db: true }, mutating: true })).toThrow(/--confirm/);
    expect(() => resolveScriptTarget({ argv: ['--target', 'production', '--confirm', 'wrong'], env: PROD_ENV, uses: { db: true }, mutating: true })).toThrow(/--confirm/);
    expect(resolveScriptTarget({ argv: ['--target', 'production', '--confirm', 'ep-dawn-sun-ahkhrdkl'], env: PROD_ENV, uses: { db: true }, mutating: true }).target).toBe('production');
    expect(resolveScriptTarget({ argv: ['--target', 'production', '--confirm', 'iprep-bucket'], env: PROD_ENV, uses: { r2: true }, mutating: true }).target).toBe('production');
  });

  it('refuses a preview target that points at production resources', () => {
    expect(() => resolveScriptTarget({ argv: ['--target', 'preview'], env: PROD_ENV, uses: { db: true }, mutating: true })).toThrow(/Refusing/);
    expect(() => resolveScriptTarget({ argv: ['--target', 'preview'], env: { ...PROD_ENV, DATABASE_URL: PREVIEW_DB }, uses: { db: true, r2: true }, mutating: true })).toThrow(/R2 bucket/);
  });

  it('refuses a mixed target (production bucket with a preview database)', () => {
    expect(() => resolveScriptTarget({ argv: ['--target', 'production', '--confirm', 'iprep-bucket'], env: { ...PROD_ENV, DATABASE_URL: PREVIEW_DB }, uses: { db: true, r2: true }, mutating: true })).toThrow();
  });

  it('destructive scripts are dry runs unless --execute', () => {
    const base = { env: { DATABASE_URL: PREVIEW_DB, R2_BUCKET_NAME: 'other' }, uses: { db: true, r2: true }, mutating: true, destructive: true };
    expect(resolveScriptTarget({ ...base, argv: ['--target', 'preview'] }).dryRun).toBe(true);
    expect(resolveScriptTarget({ ...base, argv: ['--target', 'preview', '--execute'] }).dryRun).toBe(false);
  });

  it('rejects an unknown target value', () => {
    expect(() => resolveScriptTarget({ argv: ['--target', 'prod'], env: PROD_ENV, uses: { db: true }, mutating: true })).toThrow(/Invalid --target/);
  });
});

describe('no script loads production credentials implicitly', () => {
  const dir = join(__dirname, '..', '..', 'scripts');
  const files = readdirSync(dir).filter((f) => /\.(ts|mjs|js)$/.test(f));

  it('no script mentions .env.production.local', () => {
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\.env\.production\.local/);
  });

  it('no script calls dotenv config() implicitly', () => {
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\bconfig\(\s*(\{|\))/);
  });

  it('scripts do not read other tools config files for credentials', () => {
    const loadsClaudeJson = /(readFileSync|existsSync|join)\([^)\n]*claude\.json/;
    for (const f of [...files, 'lib/iprep-api.ts']) expect(loadsClaudeJson.test(readFileSync(join(dir, f), 'utf8')), f).toBe(false);
  });
});
