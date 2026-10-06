#!/usr/bin/env npx tsx
/**
 * Read-only divergence check between the legacy tables and the canonical attempt ledger.
 *
 *   npx tsx scripts/ledger-check.ts --target preview --env-file ~/.config/iprep/preview-runtime.env
 *
 * While practice and quiz flows dual-write (docs/P1_LEARNER_ATTEMPT_LEDGER.md), every legacy answer must have a
 * canonical attempt and the two must agree. Exit code 1 means a divergence was found. Writes nothing.
 */
import { PrismaClient } from '@prisma/client';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

interface Check {
  name: string;
  /** What a non-zero count means. */
  meaning: string;
  sql: string;
}

export const CHECKS: Check[] = [
  {
    name: 'users-without-learner',
    meaning: 'accounts with no learner (created before the backfill, or by a path that skips registration)',
    sql: `SELECT count(*)::int AS n FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Learner" l WHERE l."userId" = u."id")`,
  },
  {
    name: 'principals-without-learner',
    meaning: 'machine principals not bound to a learner',
    sql: `SELECT count(*)::int AS n FROM "MachinePrincipal" WHERE "learnerId" IS NULL`,
  },
  {
    name: 'principal-learner-mismatch',
    meaning: 'a principal whose learner is not its user\'s learner',
    sql: `SELECT count(*)::int AS n FROM "MachinePrincipal" m JOIN "Learner" l ON l."id" = m."learnerId" WHERE l."userId" <> m."userId"`,
  },
  {
    name: 'owned-session-items-without-attempt',
    meaning: 'an answer saved in the legacy table whose ledger write failed or never ran',
    sql: `SELECT count(*)::int AS n FROM "SessionItem" si JOIN "Session" s ON s."id" = si."sessionId"
          WHERE s."userId" IS NOT NULL AND si."attemptId" IS NULL`,
  },
  {
    name: 'attempt-learner-differs-from-session-owner',
    meaning: 'a SessionItem linked to an attempt that belongs to a different learner than the session owner',
    sql: `SELECT count(*)::int AS n FROM "SessionItem" si
          JOIN "Session" s ON s."id" = si."sessionId"
          JOIN "Attempt" a ON a."id" = si."attemptId"
          JOIN "Learner" l ON l."id" = a."learnerId"
          WHERE l."userId" IS DISTINCT FROM s."userId"`,
  },
  {
    name: 'overall-score-differs',
    meaning: 'legacy answerQuality differs from the latest completed AI evaluation of the same attempt',
    sql: `SELECT count(*)::int AS n FROM "SessionItem" si
          JOIN LATERAL (
            SELECT e."id" FROM "AttemptEvaluation" e
            WHERE e."attemptId" = si."attemptId" AND e."status" = 'COMPLETED' AND e."kind" <> 'DETERMINISTIC'
              AND EXISTS (SELECT 1 FROM "AttemptMeasurement" m WHERE m."evaluationId" = e."id" AND m."metric" = 'answerQuality')
            ORDER BY COALESCE(e."evaluatedAt", e."recordedAt") DESC, e."recordedAt" DESC LIMIT 1
          ) cur ON TRUE
          JOIN "AttemptMeasurement" m ON m."evaluationId" = cur."id" AND m."metric" = 'answerQuality'
          WHERE si."answerQuality" IS DISTINCT FROM m."value"`,
  },
  {
    name: 'quiz-attempts-without-attempt',
    meaning: 'a quiz answer saved in the legacy table with no canonical attempt (legacyRef pairing)',
    sql: `SELECT count(*)::int AS n FROM "QuizAttempt" qa
          WHERE NOT EXISTS (SELECT 1 FROM "Attempt" a WHERE a."legacyRef" = 'QuizAttempt:' || qa."id")`,
  },
];

async function main() {
  const argv = process.argv.slice(2);
  Object.assign(process.env, loadExplicitEnvFile(argv));
  try {
    printTarget('Ledger divergence check (read-only)', resolveScriptTarget({ argv, env: process.env, uses: { db: true }, mutating: false }));
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }

  const prisma = new PrismaClient();
  let bad = 0;
  try {
    for (const c of CHECKS) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(c.sql);
      const n = Number(rows[0]?.n ?? 0);
      console.log(`${n === 0 ? 'ok  ' : 'FAIL'} ${c.name}: ${n}${n === 0 ? '' : `  (${c.meaning})`}`);
      if (n > 0) bad++;
    }
  } finally {
    await prisma.$disconnect();
  }
  process.exit(bad === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
