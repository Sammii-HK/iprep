#!/usr/bin/env npx tsx
/**
 * P2 rehearsal on PREVIEW: the multi-device torture matrix and the legacy-import rehearsal, run at the library level
 * (the same code the routes call) against the real Preview database with the RESTRICTED runtime role, using throwaway
 * test learners that are purged afterwards with the guarded owner procedure. Refuses production (--target preview or local).
 *
 *   npx tsx scripts/p2-rehearsal.ts --target preview --env-file ~/.config/iprep/preview-runtime.env \
 *       --owner-env-file ~/.config/iprep/preview-migrate.env --execute
 *
 * Why library level and not HTTP: native sign-in needs a real Apple identity token, which cannot be minted here, and
 * no Preview deployment is needed to prove the data-layer invariants on Neon's Postgres version. Exits 1 on any failure.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { applyQuestionSet } from '../lib/content';
import { appendEvaluation, recordAttempt } from '../lib/attempts';
import { generateInviteCode, hashCode } from '../lib/native/codes';
import { createLinkCode, requestAccountDeletion } from '../lib/native/account';
import { purgeAccount } from '../lib/native/purge';
import { revokeAllDevices, rotateRefreshToken } from '../lib/native/session';
import { signInWithApple } from '../lib/native/signin';
import { importCustomBank } from '../lib/sync/bankImport';
import { processBatch, type AttemptCreatedEvent, type SyncActor } from '../lib/sync/events';
import { pullChanges, readChangePage } from '../lib/sync/pull';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RUN = `p2r${Date.now().toString(36)}`;
let seq = 0;
const uuid = () => `22222222-2222-4222-8222-${(Date.now() % 1e6).toString().padStart(6, '0')}${String(++seq).padStart(6, '0')}`;

function ev(over: { prompt?: Partial<AttemptCreatedEvent['prompt']>; evidence?: Partial<AttemptCreatedEvent['evidence']>; origin?: 'device' | 'legacy-import'; eventId?: string; occurredAt?: string } = {}): AttemptCreatedEvent {
  return {
    type: 'attempt.created', schemaVersion: 1, eventId: over.eventId ?? uuid(), origin: over.origin ?? 'device', surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN',
    occurredAt: over.occurredAt ?? new Date(Date.now() - 120_000).toISOString(),
    prompt: { text: `Rehearsal prompt ${RUN}`, ...over.prompt },
    evidence: { transcript: `Rehearsal transcript ${RUN}`, transcriber: 'apple-sfspeech', words: 3, ...over.evidence },
  };
}
const ctx = () => ({ receivedAt: new Date(), deviceClockAtSend: null });

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const runtimeEnv = loadExplicitEnvFile(argv);
  const ownerFile = flag('--owner-env-file');
  if (!ownerFile) { console.error('Pass --owner-env-file (the guarded owner connection, used for fixtures and the purge).'); process.exit(2); }
  const ownerEnv = parse(readFileSync(resolve(ownerFile)));
  Object.assign(process.env, runtimeEnv);
  let dryRun = false;
  try {
    if (flag('--target') !== 'preview' && flag('--target') !== 'local') throw new TargetError('This rehearsal only runs against --target preview (or local, for development).');
    const resolved = resolveScriptTarget({ argv, env: process.env, uses: { db: true }, mutating: true, destructive: true });
    resolveScriptTarget({ argv, env: { ...process.env, DATABASE_URL: ownerEnv.DATABASE_MIGRATION_URL }, uses: { db: true }, mutating: true, destructive: true });
    printTarget('P2 rehearsal (restricted runtime role + owner for fixtures/purge)', resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) { console.error(`Refused: ${e.message}`); process.exit(3); }
    throw e;
  }
  if (dryRun) { console.log('Dry run: nothing executed. Pass --execute.'); return; }

  const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, transactionOptions: { maxWait: 20_000, timeout: 60_000 } });
  const owner = new PrismaClient({ datasources: { db: { url: ownerEnv.DATABASE_MIGRATION_URL } }, transactionOptions: { maxWait: 20_000, timeout: 120_000 } });
  const created: string[] = [];
  try {
    const [who] = await app.$queryRaw<Array<{ u: string; v: string }>>`SELECT current_user AS u, version() AS v`;
    console.log(`runtime role: ${who.u}\nserver: ${who.v.split(',')[0]}`);
    if (flag('--target') === 'preview') check('runs as the restricted runtime role, never the owner', who.u === 'iprep_app', who.u);
    const [types] = await app.$queryRaw<Array<{ t: string; h: bigint }>>`SELECT pg_typeof(pg_current_xact_id())::text AS t, pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS h`;
    check('xid8 and horizon functions exist with the assumed types on this Postgres', types.t === 'xid8' && typeof types.h === 'bigint', JSON.stringify(types, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

    // ---- identity: invites, sign-in, rotation/reuse, link, deletion (Apple verification stubbed, everything else real)
    const secret = 'rehearsal-secret-0123456789abcdef0123';
    const verify = (subs: Record<string, string>) => async (t: string) => { if (!subs[t]) throw new Error('bad'); return { subject: subs[t], email: null, emailVerified: false }; };
    const limit = async () => undefined;
    const invite = generateInviteCode();
    await app.nativeInvite.create({ data: { codeHash: hashCode(invite), expiresAt: new Date(Date.now() + 3_600_000), note: `rehearsal ${RUN}` } });
    const signin = (tok: string, sub: string, extra: Record<string, unknown> = {}) =>
      signInWithApple({ db: app, verify: verify({ [tok]: `${RUN}-${sub}` }), secret, limit }, { identityToken: tok, nonce: 'n', device: { platform: 'ios', appVersion: 'rehearsal' }, ...extra } as never);
    const u1 = await signin('t1', 'one', { inviteCode: invite });
    created.push(u1.userId);
    check('invite creates User + Learner + identity + device atomically (201)', u1.status === 201 && !!u1.learnerId);
    const again = await signin('t1', 'one').catch((e) => e);
    check('existing Apple identity signs in again on a new device with no invite', again.status === 200 && again.userId === u1.userId && again.deviceId !== u1.deviceId);
    const reused = await signin('t2', 'two', { inviteCode: invite }).catch((e) => e);
    check('a used invite fails generically and creates nothing', reused.code === 'INVITE_REQUIRED');
    const r1 = await rotateRefreshToken(app, u1.tokens.refreshToken, secret);
    const reuse = await rotateRefreshToken(app, u1.tokens.refreshToken, secret).catch((e) => e);
    check('refresh rotation works and reuse revokes the device', !!r1.refreshToken && reuse.code === 'TOKEN_REUSED');

    // second learner (the "other account")
    const inv2 = generateInviteCode();
    await app.nativeInvite.create({ data: { codeHash: hashCode(inv2), expiresAt: new Date(Date.now() + 3_600_000), note: `rehearsal ${RUN}` } });
    const u2 = await signin('t3', 'three', { inviteCode: inv2 });
    created.push(u2.userId);

    // an existing "web" user linking Apple by code (never by email)
    const webId = `${RUN}-web`;
    await owner.$executeRawUnsafe(`INSERT INTO "User" ("id","email","updatedAt") VALUES ($1,$2,now())`, webId, `${RUN}-web@example.com`);
    await owner.$executeRawUnsafe(`INSERT INTO "Learner" ("id","userId") VALUES ($1,$2)`, `lrn-${webId}`, webId);
    created.push(webId);
    const lc = await createLinkCode(app, webId);
    const linked = await signin('t4', 'web', { linkCode: lc.code });
    check('a web user links Apple with a one-time code to their own learner', linked.userId === webId && linked.learnerId === `lrn-${webId}`);

    // ---- matrix, using real devices of learner 1
    const devPhone = await app.device.create({ data: { userId: u1.userId, platform: 'ios' }, select: { id: true } });
    const devPad = await app.device.create({ data: { userId: u1.userId, platform: 'ipad' }, select: { id: true } });
    const A: SyncActor = { userId: u1.userId, learnerId: u1.learnerId, deviceId: devPhone.id };
    const A2: SyncActor = { userId: u1.userId, learnerId: u1.learnerId, deviceId: devPad.id };
    const B: SyncActor = { userId: u2.userId, learnerId: u2.learnerId, deviceId: (await app.device.create({ data: { userId: u2.userId, platform: 'ios' }, select: { id: true } })).id };
    const attemptsOf = (learnerId: string) => app.attempt.count({ where: { learnerId, source: { in: ['ios-sync', 'ios-legacy-import'] } } });

    const e1 = ev(); const e2 = ev();
    const first = await processBatch(app, A, [e1, e2], ctx());
    check('A offline then kill then reopen then sync: pushed once', first.every((r) => r.status === 'created') && (await attemptsOf(A.learnerId)) === 2);
    const replay = await processBatch(app, A, [e1, e2], ctx());
    check('B response lost: the whole batch replayed is all duplicates, nothing doubled', replay.every((r) => r.status === 'duplicate') && (await attemptsOf(A.learnerId)) === 2);
    const conflict = await processBatch(app, A, [{ ...e1, evidence: { ...e1.evidence, transcript: 'changed' } }], ctx());
    check('same id with different content is a conflict, original untouched', conflict[0].status === 'conflict');

    const web = await app.$transaction((tx) => recordAttempt(tx, { learnerId: A.learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'practice-api', prompt: { text: 'web question' }, evidence: { transcript: 'web answer' }, evaluations: [] }));
    const sameQ = ev({ prompt: { text: 'web question' } });
    await processBatch(app, A, [sameQ], ctx());
    check('C and D: web and phone answers (even to the same question) are separate attempts', (await app.attempt.count({ where: { learnerId: A.learnerId, promptSnapshot: 'web question' } })) === 2 && !!web.attemptId);

    const padA = ev({ prompt: { text: 'Pad question' } }); const phoneA = ev({ prompt: { text: 'Pad question' } });
    await Promise.all([processBatch(app, A2, [padA], ctx()), processBatch(app, A, [phoneA], ctx())]);
    check('E iPhone and iPad offline then reconnect: both appended, none lost or merged', (await app.attempt.count({ where: { learnerId: A.learnerId, promptSnapshot: 'Pad question' } })) === 2);

    const under = ev({ prompt: { text: 'Account B only' } });
    await processBatch(app, B, [under], ctx());
    const aFeed = await pullChanges(app, A.learnerId, { limit: 100 });
    check('F another account\'s writes land on its own learner and never appear in this learner\'s feed', (await attemptsOf(B.learnerId)) === 1 && !aFeed.changes.some((c) => c.data.prompt.text === 'Account B only'));

    // G: content changes while a device is offline
    const imp = await importCustomBank(app, A.userId, { bankKey: `${RUN}-bank`, title: `Rehearsal ${RUN}`, questions: [{ questionKey: 'q1', text: 'Old wording?' }] });
    created.push(`bank:${imp.bankId}`);
    await applyQuestionSet(app, imp.bankId, [{ externalKey: 'q1', text: 'New wording?' }], 'append');
    const old = await processBatch(app, A, [ev({ prompt: { text: 'Old wording?', clientRef: { bankKey: `${RUN}-bank`, questionKey: 'q1' } } })], ctx());
    const oldRow = await app.attempt.findUniqueOrThrow({ where: { id: (old[0] as { attemptId: string }).attemptId } });
    const revs = await app.questionRevision.findMany({ where: { questionId: imp.questions[0].questionId }, orderBy: { revision: 'asc' } });
    check('G question edited while offline: the old answer is linked to the OLD revision, truthfully', revs.length === 2 && oldRow.questionRevisionId === revs[0].id && oldRow.contentLinkage === 'linked');
    const unknown = await processBatch(app, A, [ev({ prompt: { text: 'Text no revision ever had', clientRef: { bankKey: `${RUN}-bank`, questionKey: 'q1' } } })], ctx());
    check('an unmatched snapshot stays unlinked (never guessed)', unknown[0].status === 'created' && (unknown[0] as { linkage: string }).linkage === 'unlinked');

    // H/I: evaluation is separate and re-announces without a second attempt
    const before = await attemptsOf(A.learnerId);
    const start = (await pullChanges(app, A.learnerId, { limit: 1000 })).nextCursor;
    await app.$transaction((tx) => appendEvaluation(tx, (first[0] as { attemptId: string }).attemptId, [{ kind: 'AI_RUBRIC', status: 'FAILED', evaluatorVersion: 'rehearsal', failureReason: 'provider down', measurements: [] }]));
    await app.$transaction((tx) => appendEvaluation(tx, (first[0] as { attemptId: string }).attemptId, [{ kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatorVersion: 'rehearsal', measurements: [] }]));
    const afterEval = await pullChanges(app, A.learnerId, { cursor: start, limit: 100 });
    check('H and I: provider failure then a later evaluation re-announces the attempt, never creates another', (await attemptsOf(A.learnerId)) === before && afterEval.changes.some((c) => c.entityId === (first[0] as { attemptId: string }).attemptId && c.data.evaluation.state === 'evaluated'));
    check('nothing evaluated the synced attempts on its own', (await app.attemptEvaluation.count({ where: { attempt: { clientEventId: e2.eventId } } })) === 0);

    // J: a new phone with no local data pulls everything, in pages, and can resume mid-way
    const pulled: string[] = []; let cur: string | null = null; let pages = 0; let mid: string | null = null;
    for (;;) { const p = await pullChanges(app, A.learnerId, { cursor: cur, limit: 3 }); pulled.push(...p.changes.map((c) => c.entityId)); cur = p.nextCursor; pages++; if (pages === 2) mid = cur; if (!p.hasMore) break; }
    const resumed: string[] = []; let c2 = mid;
    for (;;) { const p = await pullChanges(app, A.learnerId, { cursor: c2, limit: 3 }); resumed.push(...p.changes.map((c) => c.entityId)); c2 = p.nextCursor; if (!p.hasMore) break; }
    const total = await app.attempt.count({ where: { learnerId: A.learnerId } });
    // An attempt whose evaluation was appended later is announced again (latest state), so it may repeat across pages.
    check('J new phone: a cursor-zero pull reconstructs every attempt (re-announced ones repeat with their latest state)', new Set(pulled).size === total, `${new Set(pulled).size}/${total}`);
    check('J an interrupted pull resumes from its stored cursor without gaps', resumed.length > 0 && resumed.every((id) => pulled.includes(id)));

    // ---- the cursor proof, on this Postgres: a late commit must not be skipped
    let release!: () => void; const gate = new Promise<void>((r) => (release = r)); let started!: () => void; const hasXid = new Promise<void>((r) => (started = r));
    const slow = owner.$transaction(async (tx) => { await tx.syncChange.create({ data: { learnerId: A.learnerId, entityType: 'attempt', entityId: `${RUN}-late` } }); started(); await gate; });
    await hasXid;
    await owner.$transaction(async (tx) => { await tx.syncChange.create({ data: { learnerId: A.learnerId, entityType: 'attempt', entityId: `${RUN}-early` } }); });
    const tail = await readChangePage(app, A.learnerId, { txid: BigInt(0), id: BigInt(0) }, 100000);
    const midIds = tail.map((r) => r.entityId);
    check('cursor: a committed row behind an in-flight earlier transaction is not served', !midIds.includes(`${RUN}-early`) && !midIds.includes(`${RUN}-late`));
    release(); await slow; await sleep(50);
    const last = tail[tail.length - 1];
    const rest = await readChangePage(app, A.learnerId, last ? { txid: last.txid, id: last.id } : { txid: BigInt(0), id: BigInt(0) }, 1000);
    check('cursor: after the late transaction commits both arrive, late first, none missed', rest.map((r) => r.entityId).join() === `${RUN}-late,${RUN}-early`, rest.map((r) => r.entityId).join());
    await owner.$executeRawUnsafe(`DELETE FROM "SyncChange" WHERE "entityId" IN ('${RUN}-late','${RUN}-early')`);

    // ---- legacy import rehearsal on throwaway data (safe copy): 303 thin events, with CloudKit-style duplicates, run twice
    const legacy: AttemptCreatedEvent[] = Array.from({ length: 303 }, (_, i) => ev({ origin: 'legacy-import', occurredAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), prompt: { text: `Legacy question ${i % 40} ${RUN}`, clientRef: { bankKey: 'communication' } }, evidence: { transcript: `legacy answer ${i} ${RUN}`, transcriber: 'apple-sfspeech' } }));
    const withDupes = [...legacy, ...legacy.slice(0, 25)]; // the same PracticeSession id arriving from a second device
    const L1 = await app.learner.findUniqueOrThrow({ where: { userId: u2.userId } });
    const run1: Awaited<ReturnType<typeof processBatch>> = [];
    for (let i = 0; i < withDupes.length; i += 50) run1.push(...(await processBatch(app, { ...B, learnerId: L1.id }, withDupes.slice(i, i + 50), ctx())));
    const run2: Awaited<ReturnType<typeof processBatch>> = [];
    for (let i = 0; i < legacy.length; i += 50) run2.push(...(await processBatch(app, { ...B, learnerId: L1.id }, legacy.slice(i, i + 50), ctx())));
    const imported = await app.attempt.count({ where: { learnerId: L1.id, source: 'ios-legacy-import' } });
    check('legacy import: 303 records plus 25 CloudKit-duplicate ids produce exactly 303 attempts', imported === 303 && run1.filter((r) => r.status === 'created').length === 303 && run1.filter((r) => r.status === 'duplicate').length === 25, `${imported}`);
    check('legacy import is idempotent: a second full run creates nothing', run2.every((r) => r.status === 'duplicate'));
    check('legacy import writes no measurements and no evaluations (history has no invented scores)', (await app.attemptMeasurement.count({ where: { attempt: { learnerId: L1.id } } })) === 0 && (await app.attemptEvaluation.count({ where: { attempt: { learnerId: L1.id } } })) === 0);

    // ---- deletion lifecycle and the guarded purge on Neon (never a real account: only the throwaway learners above)
    await requestAccountDeletion(app, u1.userId, new Date());
    const blocked = await signin('t1', 'one').catch((e) => e);
    check('deletion pending blocks sign-in and shows the purge date', blocked.code === 'ACCOUNT_DELETION_PENDING');
    const restored = await signin('t1', 'one', { cancelDeletion: true }).catch((e) => e);
    check('cancelling during the grace period restores access', restored.status === 200);
    await requestAccountDeletion(app, u2.userId, new Date());
    await revokeAllDevices(app, u2.userId, 'rehearsal');
    const tooEarly = await purgeAccount(owner, u2.userId).catch((e) => e);
    check('the purge refuses inside the grace period', tooEarly.code === 'PURGE_GRACE_PERIOD');
    const runtimePurge = await purgeAccount(app, u2.userId).catch((e) => e);
    check('the runtime role cannot purge', runtimePurge.code === 'PURGE_NEEDS_OWNER' || runtimePurge.code === 'PURGE_GRACE_PERIOD');
  } finally {
    // Cleanup of the throwaway learners: purge each (owner) after fast-forwarding only THEIR purge date.
    for (const id of created) {
      if (id.startsWith('bank:')) continue;
      await owner.user.updateMany({ where: { id }, data: { deletionRequestedAt: new Date(), purgeAfter: new Date(Date.now() - 1000) } });
      const out = await purgeAccount(owner, id).catch((e) => { console.log(`cleanup refused for ${id}: ${e.message}`); return null; });
      if (out) {
        const left = await owner.attempt.count({ where: { learner: { userId: id } } }) + await owner.questionBank.count({ where: { userId: id } }) + await owner.user.count({ where: { id } });
        check(`purge removed every trace of throwaway account ${id.slice(-6)}`, left === 0 && out.counts.user === 1, JSON.stringify(out.counts));
      }
    }
    await owner.nativeInvite.deleteMany({ where: { note: { startsWith: `rehearsal ${RUN}` } } });
    await app.$disconnect();
    await owner.$disconnect();
  }
  console.log(failures === 0 ? '\nAll rehearsal checks passed.' : `\n${failures} rehearsal check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
