import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { canAccessOwnedRecord } from "@/lib/access";
import { handleApiError, NotFoundError } from "@/lib/errors";

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

		const quiz = await prisma.quiz.findUnique({
			where: { id },
			select: {
				id: true,
				title: true,
				description: true,
				type: true,
				userId: true,
				createdAt: true,
				bank: {
					select: {
						id: true,
						questions: {
							select: {
								id: true,
								text: true,
								hint: true,
								tags: true,
								difficulty: true,
							},
							orderBy: {
								id: "asc",
							},
						},
					},
				},
				attempts: {
					select: {
						id: true,
						questionId: true,
					},
					orderBy: {
						startedAt: "desc",
					},
				},
			},
		});

		if (!quiz) {
			throw new NotFoundError("Quiz", id);
		}

		// Owner only. An unowned quiz is an orphan: only an admin may touch it (to repair it).
		if (!canAccessOwnedRecord(quiz, user)) {
			throw new NotFoundError("Quiz", id);
		}

		let questions = quiz.bank?.questions || [];

		// Keep questions in original order (by id) - DO NOT REORDER
		// This ensures question numbers stay consistent and answers match questions

		// Limit questions based on maxQuestions query param
		if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
			questions = questions.slice(0, maxQuestions);
		}

		// Track which questions have been answered in this quiz
		const answeredQuestionIds = new Set<string>();
		quiz.attempts.forEach((attempt) => {
			answeredQuestionIds.add(attempt.questionId);
		});

		// Find the first unanswered question index (in original order)
		let firstUnansweredIndex = 0;
		for (let i = 0; i < questions.length; i++) {
			if (!answeredQuestionIds.has(questions[i].id)) {
				firstUnansweredIndex = i;
				break;
			}
		}

		return NextResponse.json({
			id: quiz.id,
			title: quiz.title,
			description: quiz.description,
			type: quiz.type,
			questions,
			attempts: quiz.attempts,
			createdAt: quiz.createdAt,
			firstUnansweredIndex, // Index of first unanswered question
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

		const quiz = await prisma.quiz.findUnique({
			where: { id },
			include: {
				_count: {
					select: {
						attempts: true,
					},
				},
			},
		});

		if (!quiz) {
			throw new NotFoundError("Quiz", id);
		}

		// Owner only (an admin may delete an orphan with no owner).
		if (!canAccessOwnedRecord(quiz, user)) {
			throw new NotFoundError("Quiz", id);
		}

		// Delete the quiz (cascade will handle related attempts)
		await prisma.quiz.delete({
			where: { id },
		});

		return NextResponse.json({
			message: "Quiz deleted successfully",
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
