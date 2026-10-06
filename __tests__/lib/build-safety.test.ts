import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

describe('builds never migrate databases', () => {
  it('the build script only generates Prisma and builds Next', () => {
    expect(pkg.scripts.build).toBe('prisma generate && next build');
  });

  it('no install, postinstall or start script migrates', () => {
    for (const name of ['postinstall', 'prepare', 'start', 'build', 'dev']) {
      expect(pkg.scripts[name] ?? '', name).not.toMatch(/migrate|db push/);
    }
  });

  it('db push is not a workflow', () => {
    expect(pkg.scripts['db:push']).toBeUndefined();
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/db push/);
  });

  it('there is no vercel.json build override that migrates', () => {
    const vercelJson = join(root, 'vercel.json');
    if (existsSync(vercelJson)) expect(readFileSync(vercelJson, 'utf8')).not.toMatch(/migrate/);
  });

  it('the stale raw migration files are gone', () => {
    expect(existsSync(join(root, 'migration.sql'))).toBe(false);
    expect(existsSync(join(root, 'MIGRATION_INSTRUCTIONS.md'))).toBe(false);
  });

  it('the Prisma schema uses a separate direct migration connection', () => {
    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/directUrl\s*=\s*env\("DATABASE_MIGRATION_URL"\)/);
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });
});
