import { spawnSync } from 'child_process';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts', 'cleanup-audio.ts');

describe('scripts/cleanup-audio.ts destructive orphan mode', () => {
  it('refuses --delete-orphans before reading any environment, database or bucket, in every combination of flags', () => {
    const variants = [['--delete-orphans'], ['--target', 'production', '--delete-orphans', '--execute'], ['--target', 'local', '--delete-orphans'], ['--execute', '--expect-delete', '1', '--delete-orphans']];
    for (const flags of variants) {
      const r = spawnSync('npx', ['tsx', script, ...flags], {
        // deliberately NO database or R2 variables: if the guard were missing the script would fail differently
        env: { NODE_ENV: 'development', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        encoding: 'utf8',
        cwd: process.cwd(),
      });
      expect(r.status, flags.join(' ') + r.stdout + r.stderr).toBe(4);
      expect(r.stderr).toMatch(/--delete-orphans is disabled/);
      expect(r.stderr).toMatch(/legitimate audio/);
      expect(r.stdout).not.toMatch(/Target:/); // it never even resolved a target
    }
  }, 60_000);
});
