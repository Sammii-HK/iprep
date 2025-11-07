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

		const quiz = await prisma.quiz.findUnique({
			where: { id },
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
				attempts: {
					include: {
						question: true,
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

		// Verify user owns the quiz (unless admin)
		if (quiz.userId && quiz.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this quiz");
		}

		let questions = quiz.bank?.questions || [];

		// Count how many times each question has been answered
		const questionAnswerCounts = new Map<string, number>();
		quiz.attempts.forEach((attempt) => {
			const count = questionAnswerCounts.get(attempt.questionId) || 0;
			questionAnswerCounts.set(attempt.questionId, count + 1);
		});

		// Reorder questions: least answered first, then by id for consistency
		questions = questions.sort((a, b) => {
			const countA = questionAnswerCounts.get(a.id) || 0;
			const countB = questionAnswerCounts.get(b.id) || 0;
			if (countA !== countB) {
				return countA - countB; // Least answered first
			}
			return a.id.localeCompare(b.id); // Then by id for consistency
		});

		// Limit questions based on maxQuestions query param
		if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
			questions = questions.slice(0, maxQuestions);
		}

		// Find the first unanswered question index
		let firstUnansweredIndex = 0;
		for (let i = 0; i < questions.length; i++) {
			const answerCount = questionAnswerCounts.get(questions[i].id) || 0;
			if (answerCount === 0) {
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

		// Verify user owns the quiz (unless admin)
		if (quiz.userId && quiz.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this quiz");
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
