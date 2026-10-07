/**
 * Explicit import of a custom iOS bank so later attempts can link to canonical questions.
 * Idempotent by (owner, bankKey): importing the same bank again returns the same mapping. It never edits existing
 * text (a question whose text differs is reported as `text_differs`, left alone), and it never merges banks by
 * title: two banks are the same only if they carry the same key.
 */
import { Prisma, type PrismaClient, type QuestionType } from '@prisma/client';
import { z } from 'zod';
import { AppError, ValidationError } from '../errors';
import { detectQuestionType } from '../csv';
import { isFactsBankTitle } from '../fact-sheet-limits';
import { normalisePrompt } from '../content';

export const BankImportSchema = z
  .object({
    bankKey: z.string().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    questions: z
      .array(
        z
          .object({
            questionKey: z.string().min(1).max(128),
            text: z.string().trim().min(1).max(2000),
            hint: z.string().trim().max(4000).nullish(),
            tags: z.array(z.string().min(1).max(64)).max(20).optional(),
            difficulty: z.number().int().min(1).max(5).optional(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

export type BankImport = z.infer<typeof BankImportSchema>;

export interface BankImportResult {
  bankId: string;
  created: boolean;
  questions: Array<{ questionKey: string; questionId: string; revisionId: string; status: 'created' | 'existing' | 'text_differs' }>;
}

export async function importCustomBank(db: PrismaClient, userId: string, input: BankImport): Promise<BankImportResult> {
  if (isFactsBankTitle(input.title)) throw new ValidationError('That title is reserved');
  const keys = new Set<string>();
  for (const q of input.questions) {
    if (keys.has(q.questionKey)) throw new ValidationError('Question keys must be unique within a bank');
    keys.add(q.questionKey);
  }

  const run = () =>
    db.$transaction(async (tx) => {
      let bank = await tx.questionBank.findUnique({ where: { userId_externalKey: { userId, externalKey: input.bankKey } }, select: { id: true } });
      const created = !bank;
      if (!bank) {
        bank = await tx.questionBank.create({
          data: { userId, title: input.title, externalKey: input.bankKey },
          select: { id: true },
        });
      }
      const existing = await tx.question.findMany({
        where: { bankId: bank.id, externalKey: { in: [...keys] } },
        select: { id: true, text: true, externalKey: true },
      });
      const byKey = new Map(existing.map((q) => [q.externalKey!, q]));
      const out: BankImportResult['questions'] = [];
      for (const q of input.questions) {
        const found = byKey.get(q.questionKey);
        if (found) {
          out.push({
            questionKey: q.questionKey,
            questionId: found.id,
            revisionId: '',
            status: normalisePrompt(found.text) === normalisePrompt(q.text) ? 'existing' : 'text_differs',
          });
          continue;
        }
        const type: QuestionType = detectQuestionType(q.text);
        const row = await tx.question.create({
          data: { bankId: bank.id, text: q.text, hint: q.hint ?? null, tags: q.tags ?? [], difficulty: q.difficulty ?? 3, type, externalKey: q.questionKey },
          select: { id: true },
        });
        out.push({ questionKey: q.questionKey, questionId: row.id, revisionId: '', status: 'created' });
      }
      // The revision ids come from the database's own record of what each question currently says.
      const revs = await tx.questionRevision.findMany({
        where: { questionId: { in: out.map((o) => o.questionId) } },
        orderBy: { revision: 'desc' },
        select: { id: true, questionId: true },
      });
      const latest = new Map<string, string>();
      for (const r of revs) if (!latest.has(r.questionId)) latest.set(r.questionId, r.id);
      for (const o of out) o.revisionId = latest.get(o.questionId) ?? '';
      return { bankId: bank.id, created, questions: out };
    }, { timeout: 30_000 });

  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return run(); // a concurrent import created it first
    if (e instanceof AppError) throw e;
    throw e;
  }
}
