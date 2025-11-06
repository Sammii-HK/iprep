import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Limit questions based on maxQuestions query param
    let questions = session.bank?.questions || [];
    if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
      questions = questions.slice(0, maxQuestions);
    }
    const items = session.items.map((item: {
      id: string;
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
      aiFeedback: string | null;
    }) => ({
      id: item.id,
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
      },
      tips: item.aiFeedback ? item.aiFeedback.split(' | ') : [],
    }));

    return NextResponse.json({
      id: session.id,
      title: session.title,
      questions,
      items,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
