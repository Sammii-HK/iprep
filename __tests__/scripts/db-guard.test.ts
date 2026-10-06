import { describe, expect, it } from 'vitest';
import { GuardError, assertMigrationRole, hashMigrations, planMigration } from '../../scripts/db/guard';

const PROD_DIRECT = 'postgresql://neondb_owner:pw@ep-dawn-sun-ahkhrdkl.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const PROD_POOLED = 'postgresql://neondb_owner:pw@ep-dawn-sun-ahkhrdkl-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const PREVIEW_DIRECT = 'postgresql://owner:pw@ep-winter-water-ahz8kwcg.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const LOCAL = 'postgresql://sammii@localhost:5432/iprep';
const HASH = 'abc123';

function plan(argv: string[], env: Record<string, string | undefined>, opts: { rehearsals?: { hash: string; at: string; host: string }[]; fileEnv?: Record<string, string> } = {}) {
  return planMigration({ argv, env, fileEnv: opts.fileEnv, migrationsHash: HASH, rehearsals: opts.rehearsals ?? [] });
}

describe('migration guard: refuses accidental production', () => {
  it('requires an explicit target and has no default', () => {
    expect(() => plan([], { DATABASE_MIGRATION_URL: LOCAL })).toThrow(/--target/);
    expect(() => plan(['--target', 'prod'], { DATABASE_MIGRATION_URL: LOCAL })).toThrow(GuardError);
  });

  it('never falls back to the runtime DATABASE_URL', () => {
    expect(() => plan(['--target', 'local'], { DATABASE_URL: LOCAL })).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('refuses a production connection when the target is preview or local', () => {
    expect(() => plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: PROD_DIRECT })).toThrow(/production database/);
    expect(() => plan(['--target', 'local'], { DATABASE_MIGRATION_URL: PROD_DIRECT })).toThrow();
  });

  it('refuses --target production for a non-production connection', () => {
    expect(() => plan(['--target', 'production', '--confirm', 'x'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT })).toThrow(/not a production database/);
  });

  it('refuses a local target for a remote connection and a preview target for a local one', () => {
    expect(() => plan(['--target', 'local'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT })).toThrow();
    expect(() => plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: LOCAL })).toThrow(/local database/);
  });

  it('refuses pooled migration connections', () => {
    expect(() => plan(['--target', 'production', '--confirm', 'ep-dawn-sun-ahkhrdkl'], { DATABASE_MIGRATION_URL: PROD_POOLED })).toThrow(/pooled/);
  });

  it('refuses when the migration connection equals the runtime connection (non-local)', () => {
    expect(() => plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT, DATABASE_URL: PREVIEW_DIRECT })).toThrow(/runtime/);
  });

  it('refuses from Vercel, build and CI contexts', () => {
    for (const k of ['VERCEL', 'VERCEL_ENV', 'CI', 'NEXT_PHASE']) {
      expect(() => plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT, [k]: '1' })).toThrow(/build or CI/);
    }
  });

  it('production shows status only until the endpoint id is typed', () => {
    const p = plan(['--target', 'production'], { DATABASE_MIGRATION_URL: PROD_DIRECT });
    expect(p.statusOnly).toBe(true);
    expect(p.notes.join(' ')).toContain('--confirm ep-dawn-sun-ahkhrdkl');
    const wrong = plan(['--target', 'production', '--confirm', 'ep-other'], { DATABASE_MIGRATION_URL: PROD_DIRECT });
    expect(wrong.statusOnly).toBe(true);
  });

  it('production apply needs a Preview rehearsal of the same migrations', () => {
    const argv = ['--target', 'production', '--confirm', 'ep-dawn-sun-ahkhrdkl'];
    expect(() => plan(argv, { DATABASE_MIGRATION_URL: PROD_DIRECT })).toThrow(/rehearsed/);
    expect(() => plan(argv, { DATABASE_MIGRATION_URL: PROD_DIRECT }, { rehearsals: [{ hash: 'different', at: 'x', host: 'y' }] })).toThrow(/rehearsed/);
    const ok = plan(argv, { DATABASE_MIGRATION_URL: PROD_DIRECT }, { rehearsals: [{ hash: HASH, at: 'x', host: 'y' }] });
    expect(ok.statusOnly).toBe(false);
    expect(ok.target).toBe('production');
  });

  it('allows a knowing waiver of the rehearsal, with a warning', () => {
    const p = plan(['--target', 'production', '--confirm', 'ep-dawn-sun-ahkhrdkl', '--accept-no-rehearsal'], { DATABASE_MIGRATION_URL: PROD_DIRECT });
    expect(p.statusOnly).toBe(false);
    expect(p.notes.join(' ')).toMatch(/WARNING/);
  });

  it('accepts preview and local runs without a confirmation', () => {
    expect(plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT }).statusOnly).toBe(false);
    expect(plan(['--target', 'local'], { DATABASE_MIGRATION_URL: LOCAL }).target).toBe('local');
  });

  it('reads the migration connection from an explicit env file value', () => {
    const p = plan(['--target', 'preview'], {}, { fileEnv: { DATABASE_MIGRATION_URL: PREVIEW_DIRECT } });
    expect(p.description).toContain('ep-winter-water-ahz8kwcg');
  });

  it('never prints the password in the description', () => {
    expect(plan(['--target', 'preview'], { DATABASE_MIGRATION_URL: PREVIEW_DIRECT }).description).not.toContain('pw');
  });
});

describe('migration role identity', () => {
  it('refuses a role that cannot create objects (a runtime role)', () => {
    expect(() => assertMigrationRole({ user: 'iprep_app', canCreateInSchema: false })).toThrow(/runtime role/);
    expect(() => assertMigrationRole({ user: 'owner', canCreateInSchema: true })).not.toThrow();
  });
});

describe('migration hash', () => {
  it('is stable, order independent and sensitive to content', () => {
    const a = [{ name: '1', content: 'x' }, { name: '2', content: 'y' }];
    expect(hashMigrations(a)).toBe(hashMigrations([...a].reverse()));
    expect(hashMigrations(a)).not.toBe(hashMigrations([{ name: '1', content: 'x' }, { name: '2', content: 'z' }]));
  });
});
