import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/errors";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const user = await requireAuth(request);
		const { id } = await params;
		const { searchParams } = new URL(request.url);
		const maxQuestionsParam = searchParams.get("maxQuestions");
		const maxQuestions = maxQuestionsParam
			? parseInt(maxQuestionsParam, 10)
			: undefined;

		const session = await prisma.session.findUnique({
			where: {
				id,
			},
			include: {
				bank: {
					include: {
						questions: {
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
					include: {
						question: true,
					},
				},
			},
		});

		if (!session) {
			throw new NotFoundError("Session", id);
		}

		// Verify user owns the session (unless admin)
		if (session.userId && session.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this session");
		}

		// Filter questions by tags if session has filterTags
		let questions = session.bank?.questions || [];
		const filterTags = (session as { filterTags?: string[] }).filterTags;
		if (filterTags && filterTags.length > 0) {
			questions = questions.filter((q) =>
				q.tags.some((tag) => filterTags.includes(tag))
			);
		}

		// Keep questions in original order (by id)
		// Don't reorder - just track which ones have been answered

		// Limit questions based on maxQuestions query param
		if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
			questions = questions.slice(0, maxQuestions);
		}

		// Track which questions have been answered in this session
		const answeredQuestionIds = new Set<string>();
		session.items.forEach((item) => {
			answeredQuestionIds.add(item.questionId);
		});

		// Find the first unanswered question index (in original order)
		let firstUnansweredIndex = 0;
		for (let i = 0; i < questions.length; i++) {
			if (!answeredQuestionIds.has(questions[i].id)) {
				firstUnansweredIndex = i;
				break;
			}
		}
		const items = session.items.map(
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

		// Verify user owns the session (unless admin)
		if (session.userId && session.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this session");
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
