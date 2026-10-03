/**
 * Per-user fact sheet.
 *
 * Stored without a schema change: a QuestionBank owned by the user with the
 * exact title `__facts__`, whose single question keeps the sheet in `hint`.
 * That bank must never show up in any user-facing list, quiz, review queue,
 * folder or practice picker, so every such query filters it with
 * `notFactsBank` (or checks `isFactsBankTitle`).
 */

import { prisma } from "@/lib/db";
import {
	FACTS_BANK_TITLE,
	FACT_SHEET_MAX_CHARS,
	isFactsBankTitle,
	notFactsBank,
	normaliseFactSheet,
} from "@/lib/fact-sheet-limits";

const FACT_QUESTION_TEXT = "Fact sheet";

export {
	FACTS_BANK_TITLE,
	FACT_SHEET_MAX_CHARS,
	isFactsBankTitle,
	notFactsBank,
	normaliseFactSheet,
};

export async function getFactSheet(userId: string): Promise<string | null> {
	const bank = await prisma.questionBank.findFirst({
		where: { userId, title: FACTS_BANK_TITLE },
		select: { questions: { select: { hint: true }, take: 1 } },
	});
	const hint = bank?.questions[0]?.hint?.trim();
	return hint ? hint : null;
}

/**
 * Save the sheet. An empty (or whitespace only) text clears it.
 * Returns the stored text, or null when cleared.
 */
export async function setFactSheet(
	userId: string,
	text: string
): Promise<string | null> {
	const sheet = normaliseFactSheet(text);

	const existing = await prisma.questionBank.findFirst({
		where: { userId, title: FACTS_BANK_TITLE },
		select: { id: true, questions: { select: { id: true }, take: 1 } },
	});

	if (!sheet) {
		if (existing) {
			await prisma.$transaction([
				prisma.question.deleteMany({ where: { bankId: existing.id } }),
				prisma.questionBank.delete({ where: { id: existing.id } }),
			]);
		}
		return null;
	}

	if (!existing) {
		await prisma.questionBank.create({
			data: {
				userId,
				title: FACTS_BANK_TITLE,
				questions: {
					create: {
						text: FACT_QUESTION_TEXT,
						hint: sheet,
						tags: [],
						difficulty: 1,
						type: "BEHAVIORAL",
					},
				},
			},
		});
		return sheet;
	}

	const questionId = existing.questions[0]?.id;
	if (questionId) {
		await prisma.question.update({
			where: { id: questionId },
			data: { hint: sheet },
		});
	} else {
		await prisma.question.create({
			data: {
				bankId: existing.id,
				text: FACT_QUESTION_TEXT,
				hint: sheet,
				tags: [],
				difficulty: 1,
				type: "BEHAVIORAL",
			},
		});
	}
	return sheet;
}
