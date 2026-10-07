/**
 * Stable question identity: edits create immutable revisions, nothing is deleted and recreated, and an attempt
 * keeps representing exactly the prompt it was given.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';
import { applyQuestionSet, resolvePrompt } from '@/lib/content';
import { importCustomBank } from '@/lib/sync/bankImport';
import { recordAttempt } from '@/lib/attempts';

describe.skipIf(!ADMIN_URL)('question identity and revisions (real database)', () => {
  let t: TestDb;
  let db: PrismaClient;
  let user: { userId: string; learnerId: string };
  let n = 0;
  const newBank = async (title = `bank ${++n}`) => (await db.questionBank.create({ data: { userId: user.userId, title }, select: { id: true } })).id;
  const revs = (questionId: string) => db.questionRevision.findMany({ where: { questionId }, orderBy: { revision: 'asc' } });

  beforeAll(async () => {
    t = await createTestDb('p2content');
    db = t.app;
    user = await makeUser(t.owner, 'owner-u');
  }, 180_000);
  afterAll(async () => {
    await t?.teardown();
  });

  it('every new question starts at revision 1, whichever code path creates it', async () => {
    const bankId = await newBank();
    const viaLib = await applyQuestionSet(db, bankId, [{ text: 'Via lib?' }], 'append');
    const viaPrisma = await db.question.create({ data: { bankId, text: 'Via prisma?', tags: [], difficulty: 2 } });
    const viaNested = await db.questionBank.create({ data: { userId: user.userId, title: 'nested', questions: { create: [{ text: 'Nested?', tags: [], difficulty: 3 }] } }, include: { questions: true } });
    for (const id of [viaLib[0].id, viaPrisma.id, viaNested.questions[0].id]) {
      const r = await revs(id);
      expect(r.map((x) => x.revision)).toEqual([1]);
    }
  });

  it('EDIT: the question keeps its id, the new text is current, the old revision is immutable, and an old attempt still says what it said', async () => {
    const bankId = await newBank();
    const [{ id }] = await applyQuestionSet(db, bankId, [{ text: 'Explain closures.', tags: ['js'] }], 'append');
    const [rev1] = await revs(id);
    const attempt = await db.$transaction((tx) =>
      recordAttempt(tx, { learnerId: user.learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'test', prompt: { questionId: id, text: 'Explain closures.', bankId }, evaluations: [] })
    );
    await db.attempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });

    const [edited] = await applyQuestionSet(db, bankId, [{ id, text: 'Explain closures, with an example.', tags: ['js'] }], 'append');
    expect(edited).toEqual({ id, action: 'updated' });
    const all = await revs(id);
    expect(all.map((r) => [r.revision, r.text])).toEqual([[1, 'Explain closures.'], [2, 'Explain closures, with an example.']]);
    expect((await db.question.findUniqueOrThrow({ where: { id } })).text).toBe('Explain closures, with an example.'); // projection for existing readers
    expect((await db.attempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).promptSnapshot).toBe('Explain closures.'); // history is not rewritten
    // a revision cannot be edited, by anyone
    await expect(t.owner.$executeRawUnsafe(`UPDATE "QuestionRevision" SET "text" = 'rewritten' WHERE "id" = '${rev1.id}'`)).rejects.toThrow(/immutable/);
    await expect(db.$executeRawUnsafe(`UPDATE "QuestionRevision" SET "text" = 'rewritten' WHERE "id" = '${rev1.id}'`)).rejects.toThrow(/permission denied/);
  });

  it('REORDER: sending the same questions in another order (with or without ids) changes nothing', async () => {
    const bankId = await newBank();
    const first = await applyQuestionSet(db, bankId, [{ text: 'One?' }, { text: 'Two?' }, { text: 'Three?' }], 'replace');
    const before = await db.questionRevision.count({ where: { question: { bankId } } });
    const byText = await applyQuestionSet(db, bankId, [{ text: 'Three?' }, { text: 'One?' }, { text: 'Two?' }], 'replace');
    expect(byText.every((r) => r.action === 'unchanged')).toBe(true);
    expect(new Set(byText.map((r) => r.id))).toEqual(new Set(first.map((r) => r.id)));
    const byId = await applyQuestionSet(db, bankId, [{ id: first[2].id, text: 'Three?' }, { id: first[0].id, text: 'One?' }, { id: first[1].id, text: 'Two?' }], 'replace');
    expect(byId.every((r) => r.action === 'unchanged')).toBe(true);
    expect(await db.questionRevision.count({ where: { question: { bankId } } })).toBe(before);
    expect(await db.question.count({ where: { bankId, archivedAt: null } })).toBe(3);
  });

  it('ADD: a new question is created with revision 1 and existing ones are untouched', async () => {
    const bankId = await newBank();
    const [a] = await applyQuestionSet(db, bankId, [{ text: 'Existing?' }], 'append');
    const added = await applyQuestionSet(db, bankId, [{ text: 'Existing?' }, { text: 'Brand new?' }], 'append');
    expect(added.map((r) => r.action)).toEqual(['unchanged', 'created']);
    expect(added[0].id).toBe(a.id);
    expect((await revs(added[1].id)).map((r) => r.revision)).toEqual([1]);
  });

  it('ARCHIVE: replace removes a question from the bank without deleting it; revisions and old attempts survive; re-adding restores the SAME id', async () => {
    const bankId = await newBank();
    const [keep, drop] = await applyQuestionSet(db, bankId, [{ text: 'Keep?' }, { text: 'Drop?' }], 'replace');
    const attempt = await db.$transaction((tx) =>
      recordAttempt(tx, { learnerId: user.learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'test', prompt: { questionId: drop.id, text: 'Drop?', bankId }, evaluations: [] })
    );
    const out = await applyQuestionSet(db, bankId, [{ text: 'Keep?' }], 'replace');
    expect(out).toEqual([{ id: keep.id, action: 'unchanged' }]);
    const dropped = await db.question.findUniqueOrThrow({ where: { id: drop.id } });
    expect(dropped.archivedAt).not.toBeNull();
    expect(await revs(drop.id)).toHaveLength(1);
    expect((await db.attempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).questionId).toBe(drop.id);
    // archived content still resolves, so an offline answer to it is not lost to "unlinked"
    const resolved = await resolvePrompt(db, { id: user.userId }, { text: 'Drop?', questionId: drop.id });
    expect(resolved.linkage).toBe('linked');
    // putting it back un-archives the same question
    const back = await applyQuestionSet(db, bankId, [{ text: 'Keep?' }, { text: 'Drop?' }], 'replace');
    expect(back[1]).toEqual({ id: drop.id, action: 'unarchived' });
    expect((await db.question.findUniqueOrThrow({ where: { id: drop.id } })).archivedAt).toBeNull();
  });

  it('matches by externalKey before text, so a rename keeps identity', async () => {
    const bankId = await newBank();
    const [q] = await applyQuestionSet(db, bankId, [{ externalKey: 'k1', text: 'Original wording?' }], 'append');
    const [renamed] = await applyQuestionSet(db, bankId, [{ externalKey: 'k1', text: 'Reworded?' }], 'append');
    expect(renamed).toEqual({ id: q.id, action: 'updated' });
    expect(await db.question.count({ where: { bankId } })).toBe(1);
    expect((await revs(q.id)).map((r) => r.text)).toEqual(['Original wording?', 'Reworded?']);
  });

  it('the database records a revision for direct SQL edits too, but not for no-op or archive updates', async () => {
    const bankId = await newBank();
    const [{ id }] = await applyQuestionSet(db, bankId, [{ text: 'Trigger test?', tags: ['a'] }], 'append');
    await db.question.update({ where: { id }, data: { tags: ['a', 'b'] } });
    expect(await revs(id)).toHaveLength(2);
    await db.question.update({ where: { id }, data: { tags: ['a', 'b'] } }); // no change
    await db.question.update({ where: { id }, data: { archivedAt: new Date() } }); // not content
    expect(await revs(id)).toHaveLength(2);
    await db.question.update({ where: { id }, data: { difficulty: 5 } });
    expect(await revs(id)).toHaveLength(3);
  });

  it('hard-deleting a question (the bank delete path) leaves the attempt readable: references cleared, snapshot kept', async () => {
    const bankId = await newBank();
    const [{ id }] = await applyQuestionSet(db, bankId, [{ text: 'To be deleted?' }], 'append');
    const [rev] = await revs(id);
    const a = await db.$transaction((tx) =>
      recordAttempt(tx, { learnerId: user.learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'test', prompt: { questionId: id, text: 'To be deleted?', bankId }, evaluations: [] })
    );
    await t.owner.$executeRawUnsafe(`UPDATE "Attempt" SET "questionRevisionId" = '${rev.id}' WHERE "id" = '${a.attemptId}'`).catch(() => undefined);
    await db.question.delete({ where: { id } });
    const kept = await db.attempt.findUniqueOrThrow({ where: { id: a.attemptId } });
    expect(kept).toMatchObject({ questionId: null, promptSnapshot: 'To be deleted?' });
    expect(await db.questionRevision.count({ where: { questionId: id } })).toBe(0); // revisions go with their question
  });

  describe('custom bank import', () => {
    it('is idempotent, reports differing text without changing it, and adds only missing questions', async () => {
      const first = await importCustomBank(db, user.userId, { bankKey: 'imp-1', title: 'Imported', questions: [{ questionKey: 'a', text: 'A?' }, { questionKey: 'b', text: 'B?' }] });
      expect(first.created).toBe(true);
      const again = await importCustomBank(db, user.userId, { bankKey: 'imp-1', title: 'Imported', questions: [{ questionKey: 'a', text: 'A?' }, { questionKey: 'b', text: 'B changed on the phone?' }, { questionKey: 'c', text: 'C?' }] });
      expect(again.created).toBe(false);
      expect(again.bankId).toBe(first.bankId);
      expect(again.questions.map((q) => q.status)).toEqual(['existing', 'text_differs', 'created']);
      const b = await db.question.findFirstOrThrow({ where: { bankId: first.bankId, externalKey: 'b' } });
      expect(b.text).toBe('B?'); // the server copy was never edited by the import
    });

    it('never merges banks by similar title: the key is the identity', async () => {
      const x = await importCustomBank(db, user.userId, { bankKey: 'same-title-1', title: 'Interview prep', questions: [{ questionKey: 'q', text: 'Q?' }] });
      const y = await importCustomBank(db, user.userId, { bankKey: 'same-title-2', title: 'Interview prep', questions: [{ questionKey: 'q', text: 'Q?' }] });
      expect(x.bankId).not.toBe(y.bankId);
    });

    it('rejects the reserved facts title and duplicate question keys; concurrent imports of one key make one bank', async () => {
      await expect(importCustomBank(db, user.userId, { bankKey: 'f', title: '__facts__', questions: [{ questionKey: 'q', text: 'Q?' }] })).rejects.toThrow(/reserved/);
      await expect(importCustomBank(db, user.userId, { bankKey: 'dup', title: 'D', questions: [{ questionKey: 'q', text: 'One?' }, { questionKey: 'q', text: 'Two?' }] })).rejects.toThrow(/unique/);
      const payload = { bankKey: 'race', title: 'Race', questions: [{ questionKey: 'q', text: 'Race?' }] };
      const results = await Promise.all([1, 2, 3].map(() => importCustomBank(db, user.userId, payload)));
      expect(new Set(results.map((r) => r.bankId)).size).toBe(1);
      expect(await db.questionBank.count({ where: { userId: user.userId, externalKey: 'race' } })).toBe(1);
    });
  });

  it('GATE: no application code deletes all questions of a bank and recreates them (only the explicit bank delete, the facts store and the account purge may)', () => {
    const root = process.cwd();
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && /question\.deleteMany/.test(readFileSync(full, 'utf8'))) offenders.push(full.replace(root, ''));
      }
    };
    walk(join(root, 'app'));
    walk(join(root, 'lib'));
    // The explicit bank delete, the private facts store (never linked, never canonical content) and the owner-level account purge.
    expect(offenders.sort()).toEqual(['/app/api/banks/[id]/route.ts', '/lib/fact-sheet.ts', '/lib/native/purge.ts']);
  });
});
