import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const maxQuestionsParam = searchParams.get('maxQuestions');
    const maxQuestions = maxQuestionsParam ? parseInt(maxQuestionsParam, 10) : undefined;
    
    const session = await prisma.session.findUnique({
      where: {
        id,
      },
      include: {
        bank: {
          include: {
            questions: {
              orderBy: {
                id: 'asc',
              },
            },
          },
        },
        items: {
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            question: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundError('Session', id);
    }

    // Limit questions based on maxQuestions query param
    let questions = session.bank?.questions || [];
    if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
      questions = questions.slice(0, maxQuestions);
    }
    const items = session.items.map((item: {
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
      tips: item.aiFeedback ? item.aiFeedback.split(' | ') : [],
      questionAnswered: item.questionAnswered,
      answerQuality: item.answerQuality,
      whatWasRight: item.whatWasRight,
      whatWasWrong: item.whatWasWrong,
      betterWording: item.betterWording,
    }));

    return NextResponse.json({
      id: session.id,
      title: session.title,
      questions,
      items,
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
      throw new NotFoundError('Session', id);
    }

    // Delete the session (cascade will handle related items)
    await prisma.session.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Session deleted successfully',
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
