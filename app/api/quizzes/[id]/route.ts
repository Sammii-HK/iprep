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
