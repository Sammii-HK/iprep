#!/usr/bin/env npx tsx
/**
 * Publish the bundled iOS catalog as shared server banks, so attempts on bundled questions can link to canonical
 * content. Banks and questions are mapped by their existing stable keys (externalKey); content is revised, never
 * recreated; nothing is deleted.
 *
 *   npx tsx scripts/publish-catalog.ts --target preview --env-file <file> --catalog <path/to/bundled-catalog.json>
 *   ... --execute      # apply (dry run otherwise); production also needs --confirm <endpoint id>
 *
 * Catalog format: { "version": n, "banks": [{ "bankKey", "title", "questions": [{ "questionKey", "text", "hint",
 * "tags", "difficulty", "type" }] }] }. Shared banks have no owner and are not listed for web users (lists only
 * show a learner's own banks).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient, QuestionType } from '@prisma/client';
import { z } from 'zod';
import { applyQuestionSet } from '../lib/content';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

const Catalog = z.object({
  version: z.number().int(),
  banks: z.array(
    z.object({
      bankKey: z.string().min(1),
      title: z.string().min(1),
      questions: z.array(
        z.object({
          questionKey: z.string().min(1),
          text: z.string().min(1).max(2000),
          hint: z.string().nullish(),
          tags: z.array(z.string()).optional(),
          difficulty: z.number().int().min(1).max(5).optional(),
          type: z.nativeEnum(QuestionType).optional(),
        })
      ),
    })
  ),
});

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const path = flag(argv, '--catalog');
  if (!path) {
    console.error('Usage: publish-catalog.ts --target <t> --env-file <file> --catalog <file> [--execute]');
    process.exit(2);
  }
  const catalog = Catalog.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
  Object.assign(process.env, loadExplicitEnvFile(argv));
  let dryRun = false;
  try {
    const resolved = resolveScriptTarget({ argv, env: process.env, uses: { db: true }, mutating: true, destructive: true });
    printTarget(`Publish catalog v${catalog.version}`, resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
  const keys = new Set<string>();
  for (const b of catalog.banks) {
    if (keys.has(b.bankKey)) throw new Error(`Duplicate bankKey ${b.bankKey}`);
    keys.add(b.bankKey);
    const qk = new Set<string>();
    for (const q of b.questions) {
      if (qk.has(q.questionKey)) throw new Error(`Duplicate questionKey ${q.questionKey} in ${b.bankKey}`);
      qk.add(q.questionKey);
    }
  }
  const prisma = new PrismaClient();
  try {
    for (const b of catalog.banks) {
      const existing = await prisma.questionBank.findFirst({ where: { userId: null, externalKey: b.bankKey }, select: { id: true } });
      console.log(`${existing ? 'update' : 'create'}  ${b.bankKey}  "${b.title}"  (${b.questions.length} questions)`);
      if (dryRun) continue;
      await prisma.$transaction(async (tx) => {
        const bank = existing ?? (await tx.questionBank.create({ data: { userId: null, title: b.title, externalKey: b.bankKey }, select: { id: true } }));
        await applyQuestionSet(
          tx,
          bank.id,
          b.questions.map((q) => ({ externalKey: q.questionKey, text: q.text, hint: q.hint ?? null, tags: q.tags, difficulty: q.difficulty, type: q.type })),
          'append'
        );
      }, { timeout: 60_000 });
    }
    console.log(dryRun ? '\nDry run: nothing written. Pass --execute.' : '\nPublished.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
