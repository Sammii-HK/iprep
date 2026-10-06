#!/usr/bin/env npx tsx
/**
 * Manage machine principals (MCP server, Notion sync, scripts, a custom GPT).
 *
 *   npx tsx scripts/principals.ts list   --target preview --env-file <file>
 *   npx tsx scripts/principals.ts create --target preview --env-file <file> --name mcp-read --email you@example.com
 *   npx tsx scripts/principals.ts create ... --name mcp-read --email you@example.com --execute   # actually create
 *   npx tsx scripts/principals.ts revoke --target preview --env-file <file> --name mcp-read --execute
 *
 * - `create` and `revoke` are dry runs unless --execute. Production needs --confirm <endpoint id>.
 * - A principal acts as ONE learner (--email) and holds explicit scopes. --name picks a preset from
 *   lib/machine-auth.ts (mcp-read, mcp-write, notion-sync, facts-seed, audio-tools) or pass --scopes a,b.
 * - The token is printed once and only its hash is stored. A principal is never admin.
 */
import { PrismaClient } from '@prisma/client';
import { canonicalEmail } from '../lib/email';
import {
  MACHINE_SCOPES,
  PRINCIPAL_PRESETS,
  generateMachineToken,
  hashMachineToken,
  validScopes,
} from '../lib/machine-auth';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!['list', 'create', 'revoke'].includes(command ?? '')) {
    console.error('Usage: principals.ts <list|create|revoke> --target <local|preview|production> --env-file <file> ...');
    process.exit(2);
  }
  Object.assign(process.env, loadExplicitEnvFile(argv));

  let dryRun = false;
  try {
    const resolved = resolveScriptTarget({
      argv,
      env: process.env,
      uses: { db: true },
      mutating: command !== 'list',
      destructive: command !== 'list',
    });
    printTarget(`Machine principals: ${command}`, resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }

  const prisma = new PrismaClient();
  try {
    if (command === 'list') {
      const rows = await prisma.machinePrincipal.findMany({
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { email: true } } },
      });
      for (const r of rows) {
        console.log(
          `${r.name.padEnd(14)} ${r.tokenPrefix}…  learner=${r.user.email}  scopes=${r.scopes.join(',')}  ` +
            `${r.revokedAt ? 'REVOKED' : 'active'}  lastUsed=${r.lastUsedAt?.toISOString() ?? 'never'}`
        );
      }
      if (rows.length === 0) console.log('(no machine principals)');
      return;
    }

    const name = flag(argv, '--name');
    if (!name) throw new Error('--name is required');

    if (command === 'revoke') {
      if (dryRun) return console.log(`Dry run: would revoke "${name}". Pass --execute.`);
      const r = await prisma.machinePrincipal.updateMany({ where: { name, revokedAt: null }, data: { revokedAt: new Date() } });
      return console.log(r.count ? `Revoked "${name}".` : `No active principal named "${name}".`);
    }

    // create
    const email = flag(argv, '--email');
    if (!email) throw new Error('--email <learner email> is required (the learner this principal acts as)');
    const scopes = flag(argv, '--scopes')?.split(',').map((s) => s.trim()) ?? [...(PRINCIPAL_PRESETS[name] ?? [])];
    if (scopes.length === 0) throw new Error(`No scopes: "${name}" is not a preset. Pass --scopes. Valid: ${MACHINE_SCOPES.join(', ')}`);
    if (!validScopes(scopes)) throw new Error(`Unknown scope in ${scopes.join(',')}. Valid: ${MACHINE_SCOPES.join(', ')}`);
    const user = await prisma.user.findUnique({ where: { email: canonicalEmail(email) }, select: { id: true, email: true } });
    if (!user) throw new Error(`No learner with email ${email}`);
    const days = Number(flag(argv, '--expires-days') ?? '0');

    console.log(`Principal "${name}" would act as ${user.email} with scopes: ${scopes.join(', ')}${days ? ` (expires in ${days} days)` : ''}`);
    if (dryRun) return console.log('Dry run: nothing created. Pass --execute.');

    const token = generateMachineToken();
    await prisma.machinePrincipal.create({
      data: {
        name,
        tokenHash: hashMachineToken(token),
        tokenPrefix: token.slice(0, 8),
        scopes,
        userId: user.id,
        expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
      },
    });
    console.log('\nCreated. Copy the token now; it is shown once and only its hash is stored:\n');
    console.log(`  ${token}\n`);
    console.log('Use it as: Authorization: Bearer <token>   (scripts read it from IPREP_API_TOKEN)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
