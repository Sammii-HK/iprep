/**
 * Stable content identity and prompt resolution.
 *
 *  - A Question id never changes: it is the conceptual authored question.
 *  - A QuestionRevision is the immutable version a learner was shown. The database records a revision whenever a
 *    question is created or its content changes (trigger), so no code path can forget; Question.text and friends
 *    are the projection of the latest revision, so existing readers are unchanged.
 *  - externalKey only maps a client's own key (bundled iOS slug, imported local id) to a server row.
 *  - A prompt resolves to canonical content only when its snapshot EQUALS a retained revision's text. Anything
 *    less certain is "unlinked": the attempt keeps its snapshot and the client's references as provenance, and is
 *    never attached to different content.
 */
import { Prisma, type PrismaClient, type QuestionType } from '@prisma/client';
import { canReadBank } from './access';
import { detectQuestionType } from './csv';
import { isFactsBankTitle } from './fact-sheet-limits';

type Db = PrismaClient | Prisma.TransactionClient;

/** Unicode-normalised, whitespace-collapsed text for equality checks. Never used as an identifier. */
export function normalisePrompt(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export interface QuestionInput {
  id?: string;
  externalKey?: string;
  text: string;
  hint?: string | null;
  tags?: string[];
  difficulty?: number;
  type?: QuestionType;
}

export interface AppliedQuestion {
  id: string;
  action: 'created' | 'updated' | 'unchanged' | 'unarchived';
}

/**
 * Identity-preserving write for a bank's question list (replaces delete-all-and-recreate).
 * Matching, in order: explicit id, externalKey, exact normalised text. Matched questions keep their id (a content
 * change just becomes a new revision), unmatched input becomes a new question, and in `replace` mode existing
 * questions absent from the input are ARCHIVED, never deleted. Order of the input is irrelevant to identity.
 */
export async function applyQuestionSet(
  tx: Db,
  bankId: string,
  input: QuestionInput[],
  mode: 'append' | 'replace'
): Promise<AppliedQuestion[]> {
  const existing = await tx.question.findMany({ where: { bankId } });
  const claimed = new Set<string>();
  const byId = new Map(existing.map((q) => [q.id, q]));
  const byKey = new Map(existing.filter((q) => q.externalKey).map((q) => [q.externalKey!, q]));
  const results: AppliedQuestion[] = [];

  for (const item of input) {
    let match =
      (item.id ? byId.get(item.id) : undefined) ??
      (item.externalKey ? byKey.get(item.externalKey) : undefined);
    if (match && claimed.has(match.id)) match = undefined;
    if (!match) {
      const wanted = normalisePrompt(item.text);
      match = existing.find((q) => !claimed.has(q.id) && !item.externalKey && normalisePrompt(q.text) === wanted);
    }

    const type = item.type ?? (match?.type as QuestionType | undefined) ?? detectQuestionType(item.text);
    if (!match) {
      const created = await tx.question.create({
        data: {
          bankId,
          text: item.text,
          hint: item.hint ?? null,
          tags: item.tags ?? [],
          difficulty: item.difficulty ?? 3,
          type,
          externalKey: item.externalKey ?? null,
        },
        select: { id: true },
      });
      claimed.add(created.id);
      results.push({ id: created.id, action: 'created' });
      continue;
    }

    claimed.add(match.id);
    const next = {
      text: item.text,
      hint: item.hint === undefined ? match.hint : item.hint,
      tags: item.tags ?? match.tags,
      difficulty: item.difficulty ?? match.difficulty,
      type,
    };
    const changed =
      next.text !== match.text ||
      next.hint !== match.hint ||
      next.difficulty !== match.difficulty ||
      next.type !== match.type ||
      next.tags.join('\u0000') !== match.tags.join('\u0000');
    const unarchive = match.archivedAt !== null;
    if (changed || unarchive || (item.externalKey && !match.externalKey)) {
      await tx.question.update({
        where: { id: match.id },
        data: { ...next, archivedAt: null, ...(item.externalKey && !match.externalKey ? { externalKey: item.externalKey } : {}) },
      });
    }
    results.push({ id: match.id, action: unarchive ? 'unarchived' : changed ? 'updated' : 'unchanged' });
  }

  if (mode === 'replace') {
    const drop = existing.filter((q) => !claimed.has(q.id) && q.archivedAt === null).map((q) => q.id);
    if (drop.length > 0) {
      await tx.question.updateMany({ where: { id: { in: drop } }, data: { archivedAt: new Date() } });
    }
  }
  return results;
}

// ---- prompt resolution ----------------------------------------------------------------------------------------

export interface PromptInput {
  text: string;
  questionId?: string | null;
  questionRevisionId?: string | null;
  clientRef?: { bankKey?: string | null; questionKey?: string | null } | null;
}

export interface ResolvedPrompt {
  linkage: 'linked' | 'unlinked';
  questionId: string | null;
  questionRevisionId: string | null;
  bankId: string | null;
}

const UNLINKED: ResolvedPrompt = { linkage: 'unlinked', questionId: null, questionRevisionId: null, bankId: null };

/** Resolve what the learner was shown to canonical content, or say honestly that we cannot. */
export async function resolvePrompt(db: Db, actor: { id: string }, prompt: PromptInput): Promise<ResolvedPrompt> {
  const wanted = normalisePrompt(prompt.text);

  const linkedTo = (rev: { id: string; questionId: string; question: { bankId: string } }): ResolvedPrompt => ({
    linkage: 'linked',
    questionId: rev.questionId,
    questionRevisionId: rev.id,
    bankId: rev.question.bankId,
  });

  // A learner's private facts bank is never canonical content, whoever asks.
  const readable = (bank: { userId: string | null; title: string }) => canReadBank(bank, actor) && !isFactsBankTitle(bank.title);

  if (prompt.questionRevisionId) {
    const rev = await db.questionRevision.findUnique({
      where: { id: prompt.questionRevisionId },
      include: { question: { select: { bankId: true, bank: { select: { userId: true, title: true } } } } },
    });
    if (rev && readable(rev.question.bank) && normalisePrompt(rev.text) === wanted) return linkedTo(rev);
    return UNLINKED;
  }

  if (prompt.questionId) {
    const revs = await db.questionRevision.findMany({
      where: { questionId: prompt.questionId },
      orderBy: { revision: 'desc' },
      include: { question: { select: { bankId: true, bank: { select: { userId: true, title: true } } } } },
    });
    const hit = revs.find((r) => readable(r.question.bank) && normalisePrompt(r.text) === wanted);
    return hit ? linkedTo(hit) : UNLINKED;
  }

  const bankKey = prompt.clientRef?.bankKey;
  const questionKey = prompt.clientRef?.questionKey;
  if (bankKey) {
    const banks = await db.questionBank.findMany({
      where: { externalKey: bankKey, OR: [{ userId: actor.id }, { userId: null }] },
      select: { id: true, title: true },
    });
    // Two candidate banks for one key is uncertainty, not a tie to break.
    if (banks.length !== 1 || isFactsBankTitle(banks[0].title)) return UNLINKED;

    if (!questionKey) {
      // Migration machinery for history that only recorded a bank: link only when exactly ONE question in that bank
      // ever said exactly this. Several matches (or none) is uncertainty, so it stays unlinked. This is a lookup
      // aid for old records, not a permanent identity.
      const candidates = await db.questionRevision.findMany({
        where: { question: { bankId: banks[0].id } },
        orderBy: { revision: 'desc' },
        select: { id: true, questionId: true, text: true, question: { select: { bankId: true } } },
      });
      const hits = candidates.filter((r) => normalisePrompt(r.text) === wanted);
      const questions = new Set(hits.map((h) => h.questionId));
      return questions.size === 1 ? linkedTo(hits[0]) : UNLINKED;
    }
    const question = await db.question.findUnique({
      where: { bankId_externalKey: { bankId: banks[0].id, externalKey: questionKey } },
      select: { id: true },
    });
    if (!question) return UNLINKED;
    const revs = await db.questionRevision.findMany({
      where: { questionId: question.id },
      orderBy: { revision: 'desc' },
      include: { question: { select: { bankId: true } } },
    });
    const hit = revs.find((r) => normalisePrompt(r.text) === wanted);
    return hit ? linkedTo(hit) : UNLINKED;
  }
  return UNLINKED;
}
