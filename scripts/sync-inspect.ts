#!/usr/bin/env npx tsx
/**
 * Read-only sync diagnostics for one learner/user: devices, last push and cursor, recent event results, attempts by
 * source and linkage, evaluation state. Answers "did this attempt reach the server, and what happened to it?".
 *
 *   npx tsx scripts/sync-inspect.ts --target preview --env-file ~/.config/iprep/preview-runtime.env --user <userId>
 *   ... --event <eventId>      # trace one client event
 */
import { PrismaClient } from '@prisma/client';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  Object.assign(process.env, loadExplicitEnvFile(argv));
  try {
    printTarget('Sync inspect (read-only)', resolveScriptTarget({ argv, env: process.env, uses: { db: true }, mutating: false }));
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
  const userId = flag(argv, '--user');
  if (!userId) {
    console.error('Pass --user <userId>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const learner = await prisma.learner.findUnique({ where: { userId }, select: { id: true } });
    if (!learner) return console.log('No learner for that user.');
    const eventId = flag(argv, '--event');
    if (eventId) {
      const attempt = await prisma.attempt.findUnique({
        where: { learnerId_clientEventId: { learnerId: learner.id, clientEventId: eventId } },
        include: { evaluations: { select: { kind: true, status: true } } },
      });
      console.log(attempt ? `attempt ${attempt.id} source=${attempt.source} linkage=${attempt.contentLinkage} occurredAt=${attempt.occurredAt.toISOString()} recordedAt=${attempt.recordedAt.toISOString()} suspectClock=${attempt.occurredAtSuspect} evaluations=${attempt.evaluations.length}` : 'No attempt with that event id.');
      const log = await prisma.syncEventLog.findMany({ where: { learnerId: learner.id, eventId }, orderBy: { receivedAt: 'asc' } });
      for (const l of log) console.log(`  ${l.receivedAt.toISOString()} ${l.result}${l.errorCode ? ` (${l.errorCode})` : ''} device=${l.deviceId ?? '-'}`);
      return;
    }
    const devices = await prisma.device.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    for (const d of devices) console.log(`device ${d.id} ${d.platform} v${d.appVersion ?? '?'} ${d.revokedAt ? `REVOKED(${d.revokedReason})` : 'active'} lastSeen=${d.lastSeenAt?.toISOString() ?? 'never'} lastPush=${d.lastPushAt?.toISOString() ?? 'never'} cursor=${d.lastCursor ? 'set' : 'none'}`);
    if (devices.length === 0) console.log('(no devices)');
    const bySource = await prisma.attempt.groupBy({ by: ['source', 'contentLinkage'], where: { learnerId: learner.id }, _count: true });
    for (const r of bySource) console.log(`attempts source=${r.source} linkage=${r.contentLinkage}: ${r._count}`);
    const results = await prisma.syncEventLog.groupBy({ by: ['result', 'errorCode'], where: { learnerId: learner.id }, _count: true });
    for (const r of results) console.log(`events ${r.result}${r.errorCode ? ` (${r.errorCode})` : ''}: ${r._count}`);
    const suspect = await prisma.attempt.count({ where: { learnerId: learner.id, occurredAtSuspect: true } });
    console.log(`attempts with a suspect device clock: ${suspect}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
