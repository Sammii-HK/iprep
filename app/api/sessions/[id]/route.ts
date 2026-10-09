import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, requireAccess } from "@/lib/auth";
import { canAccessOwnedRecord } from "@/lib/access";
import { isFactsBankTitle } from "@/lib/fact-sheet";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/errors";
import { LEARNING_CONTEXTS, type LearningContext } from "@/lib/learning-context";
import { orderSessionQuestions } from "@/lib/session-questions";
import { selectionTerms } from "@/lib/role-profiles";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { user } = await requireAccess(request, 'sessions:read');
		const { id } = await params;
		const { searchParams } = new URL(request.url);
		const maxQuestionsParam = searchParams.get("maxQuestions");
		const maxQuestions = maxQuestionsParam
			? parseInt(maxQuestionsParam, 10)
			: undefined;

		// Opt-in: rank by learning value instead of database order (see lib/session-questions).
		const smart = searchParams.get("smart") === "1";
		const contextParam = searchParams.get("context");
		const activeContext = (LEARNING_CONTEXTS as readonly string[]).includes(contextParam ?? "")
			? (contextParam as LearningContext)
			: undefined;

		const session = await prisma.session.findUnique({
			where: {
				id,
			},
			include: {
				bank: {
					include: {
						questions: {
							select: {
								id: true,
								text: true,
								hint: true,
								tags: true,
								difficulty: true,
							type: true,
							},
							orderBy: {
								id: "asc",
							},
						},
					},
				},
				items: {
					orderBy: {
						createdAt: "desc",
					},
				},
			},
		});

		if (!session) {
			throw new NotFoundError("Session", id);
		}

		// Owner only (an admin may read an orphan with no owner).
		if (!canAccessOwnedRecord(session, user)) {
			throw new NotFoundError("Session", id);
		}

		// Validate session has a bank
		if (!session.bank) {
			throw new ValidationError("Session's question bank no longer exists");
		}

		// Filter questions by tags if session has filterTags
		let questions = session.bank.questions || [];
		const filterTags = (session as { filterTags?: string[] }).filterTags;
		if (filterTags && filterTags.length > 0) {
			questions = questions.filter((q: { tags: string[] }) =>
				q.tags.some((tag: string) => filterTags.includes(tag))
			);
		}

		// The facts bank is private source material, never practice content.
		if (isFactsBankTitle(session.bank.title)) {
			throw new NotFoundError("Session", id);
		}

		if (smart) {
			const rows = await prisma.userQuestionProgress.findMany({
				where: { userId: user.id, questionId: { in: questions.map((q: { id: string }) => q.id) } },
				select: { questionId: true, nextReviewAt: true, lastPracticed: true, lastScore: true, repetitions: true },
			});
			const answeredInSession = [...session.items]
				.sort((a: { createdAt: Date }, b: { createdAt: Date }) => a.createdAt.getTime() - b.createdAt.getTime())
				.map((i: { questionId: string }) => i.questionId);
			// Upcoming scheduled interviews raise relevant questions; they never filter anything out.
			const interviews = await prisma.interview.findMany({
				where: { userId: user.id, status: "scheduled", startsAt: { gte: new Date() } },
				select: { company: true, role: true, startsAt: true, status: true },
				orderBy: { startsAt: "asc" },
				take: 5,
			});
			const terms = selectionTerms({ targetRoleTitles: [], interviews, now: new Date() });
			questions = orderSessionQuestions({
				questions: questions.map((q: { id: string; text: string; tags: string[] }) => ({ ...q, bankId: session.bankId ?? "" })),
				answeredInSession,
				progress: new Map(rows.map((r: { questionId: string; nextReviewAt: Date; lastPracticed: Date; lastScore: number | null; repetitions: number }) => [r.questionId, r])),
				sessionCreatedAt: session.createdAt,
				maxQuestions,
				activeContext,
				interviewTerms: terms.interviewTerms,
				roleTerms: terms.roleTerms,
			}) as unknown as typeof questions;
		} else {
			// Default: original order (by id). Don't reorder - just track which ones have been answered.
			if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
				questions = questions.slice(0, maxQuestions);
			}
		}

		// Track which questions have been answered and count attempts per question
		const answeredQuestionIds = new Set<string>();
		const attemptCounts = new Map<string, number>();
		session.items.forEach((item: { questionId: string }) => {
			answeredQuestionIds.add(item.questionId);
			const count = attemptCounts.get(item.questionId) || 0;
			attemptCounts.set(item.questionId, count + 1);
		});

		// Find the question with the least attempts (prioritize unanswered, then least attempts)
		let bestQuestionIndex = 0;
		let minAttempts = Infinity;

		for (let i = 0; i < questions.length; i++) {
			const questionId = questions[i].id;
			const attempts = attemptCounts.get(questionId) || 0;

			// If unanswered, prioritize it
			if (!answeredQuestionIds.has(questionId)) {
				bestQuestionIndex = i;
				break;
			}

			// Otherwise, find the one with least attempts
			if (attempts < minAttempts) {
				minAttempts = attempts;
				bestQuestionIndex = i;
			}
		}

		const firstUnansweredIndex = bestQuestionIndex;
		const items = (
			session.items as unknown as Array<{
				id: string;
				questionId: string;
				audioUrl: string | null;
				transcript: string | null;
				words: number | null;
				wpm: number | null;
				fillerCount: number | null;
				fillerRate: number | null;
				longPauses: number | null;
				confidenceScore: number | null;
				intonationScore: number | null;
				starScore: number | null;
				impactScore: number | null;
				clarityScore: number | null;
				technicalAccuracy: number | null;
				terminologyUsage: number | null;
				questionAnswered: boolean | null;
				answerQuality: number | null;
				whatWasRight: string[];
				whatWasWrong: string[];
				betterWording: string[];
				aiFeedback: string | null;
				dontForget: string[];
			}>
		).map(
			(item: {
				id: string;
				questionId: string;
				audioUrl: string | null;
				transcript: string | null;
				words: number | null;
				wpm: number | null;
				fillerCount: number | null;
				fillerRate: number | null;
				longPauses: number | null;
				confidenceScore: number | null;
				intonationScore: number | null;
				starScore: number | null;
				impactScore: number | null;
				clarityScore: number | null;
				technicalAccuracy: number | null;
				terminologyUsage: number | null;
				questionAnswered: boolean | null;
				answerQuality: number | null;
				whatWasRight: string[];
				whatWasWrong: string[];
				betterWording: string[];
				aiFeedback: string | null;
			}) => ({
				id: item.id,
				questionId: item.questionId,
				audioUrl: item.audioUrl,
				transcript: item.transcript,
				metrics: {
					words: item.words,
					wpm: item.wpm,
					fillerCount: item.fillerCount,
					fillerRate: item.fillerRate,
					longPauses: item.longPauses,
				},
				scores: {
					confidence: item.confidenceScore,
					intonation: item.intonationScore,
					star: item.starScore,
					impact: item.impactScore,
					clarity: item.clarityScore,
					technicalAccuracy: item.technicalAccuracy,
					terminologyUsage: item.terminologyUsage,
				},
				tips: item.aiFeedback ? item.aiFeedback.split(" | ") : [],
				questionAnswered: item.questionAnswered,
				answerQuality: item.answerQuality,
				whatWasRight: item.whatWasRight,
				whatWasWrong: item.whatWasWrong,
				betterWording: item.betterWording,
			})
		);

		return NextResponse.json({
			id: session.id,
			title: session.title,
			isCompleted: session.isCompleted,
			completedAt: session.completedAt,
			questions,
			items,
			firstUnansweredIndex, // Index of first unanswered question
			answeredQuestionIds: Array.from(answeredQuestionIds), // List of answered question IDs
		});
	} catch (error) {
		const errorResponse = handleApiError(error);
		return NextResponse.json(
			{ error: errorResponse.message },
			{ status: errorResponse.statusCode }
		);
	}
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const user = await requireAuth(request);
		const { id } = await params;

		const session = await prisma.session.findUnique({
			where: { id },
			include: {
				_count: {
					select: {
						items: true,
					},
				},
			},
		});

		if (!session) {
			throw new NotFoundError("Session", id);
		}

		// Owner only (an admin may delete an orphan with no owner).
		if (!canAccessOwnedRecord(session, user)) {
			throw new NotFoundError("Session", id);
		}

		// Delete the session (cascade will handle related items)
		await prisma.session.delete({
			where: { id },
		});

		return NextResponse.json({
			message: "Session deleted successfully",
		});
	} catch (error) {
		const errorResponse = handleApiError(error);
		return NextResponse.json(
			{
				error: errorResponse.message,
				code: errorResponse.code,
			},
			{ status: errorResponse.statusCode }
		);
	}
}
