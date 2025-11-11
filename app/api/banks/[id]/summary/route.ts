import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Get aggregated learning summary for all sessions from a specific question bank
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id: bankId } = await params;

    // Verify bank exists and user owns it
    const bank = await prisma.questionBank.findUnique({
      where: { id: bankId },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', bankId);
    }

    // Verify user owns the bank (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    // Get all sessions for this bank (including incomplete ones with items)
    const allSessions = await prisma.session.findMany({
      where: {
        bankId,
        userId: user.id,
      },
      include: {
        summary: true,
        items: {
          include: {
            question: true,
          },
        },
      },
      orderBy: {
        completedAt: 'desc',
      },
    });

    // Auto-complete sessions that have items but aren't marked as completed
    // OPTIMIZE: Process in parallel instead of sequentially to reduce CPU time
    const { analyzeSessionPerformance } = await import('@/lib/learning-analytics');
    
    const incompleteSessions = allSessions.filter(s => !s.isCompleted && s.items.length > 0);
    
    // Process sessions in parallel (limit to 5 concurrent to avoid overwhelming CPU)
    const BATCH_SIZE = 5;
    for (let i = 0; i < incompleteSessions.length; i += BATCH_SIZE) {
      const batch = incompleteSessions.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (session) => {
        try {
          const analysis = await analyzeSessionPerformance(session.id, user.id);
          
          await prisma.session.update({
            where: { id: session.id },
            data: {
              isCompleted: true,
              completedAt: session.completedAt || new Date(),
            },
          });

          try {
            await prisma.learningSummary.upsert({
              where: { sessionId: session.id },
              create: {
                userId: user.id,
                sessionId: session.id,
                bankId: session.bankId || null,
                commonMistakes: analysis.commonMistakes as unknown as Prisma.InputJsonValue,
                frequentlyForgottenPoints: analysis.frequentlyForgottenPoints as unknown as Prisma.InputJsonValue,
                weakTags: analysis.weakTags,
                strongTags: analysis.strongTags,
                recommendedFocus: analysis.recommendedFocus,
                performanceByTag: analysis.performanceByTag as Prisma.InputJsonValue,
                overallScore: analysis.overallScore,
              },
              update: {
                commonMistakes: analysis.commonMistakes as unknown as Prisma.InputJsonValue,
                frequentlyForgottenPoints: analysis.frequentlyForgottenPoints as unknown as Prisma.InputJsonValue,
                weakTags: analysis.weakTags,
                strongTags: analysis.strongTags,
                recommendedFocus: analysis.recommendedFocus,
                performanceByTag: analysis.performanceByTag as Prisma.InputJsonValue,
                overallScore: analysis.overallScore,
              },
            });
          } catch (error) {
            // If frequentlyForgottenPoints column doesn't exist, create/update without it
            if (error instanceof Error && error.message.includes('frequentlyForgottenPoints')) {
              if (process.env.NODE_ENV === "development") {
                console.warn(`frequentlyForgottenPoints column not found for session ${session.id}, creating/updating without it`);
              }
              await prisma.learningSummary.upsert({
                where: { sessionId: session.id },
                create: {
                  userId: user.id,
                  sessionId: session.id,
                  bankId: session.bankId || null,
                  commonMistakes: analysis.commonMistakes as unknown as Prisma.InputJsonValue,
                  weakTags: analysis.weakTags,
                  strongTags: analysis.strongTags,
                  recommendedFocus: analysis.recommendedFocus,
                  performanceByTag: analysis.performanceByTag as Prisma.InputJsonValue,
                  overallScore: analysis.overallScore,
                },
                update: {
                  commonMistakes: analysis.commonMistakes as unknown as Prisma.InputJsonValue,
                  weakTags: analysis.weakTags,
                  strongTags: analysis.strongTags,
                  recommendedFocus: analysis.recommendedFocus,
                  performanceByTag: analysis.performanceByTag as Prisma.InputJsonValue,
                  overallScore: analysis.overallScore,
                },
              });
            } else {
              throw error;
            }
          }

          // Reload session with summary
          const updatedSession = await prisma.session.findUnique({
            where: { id: session.id },
            include: {
              summary: true,
              items: {
                include: {
                  question: true,
                },
              },
            },
          });
          if (updatedSession) {
            Object.assign(session, updatedSession);
          }
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.error(`Error auto-completing session ${session.id}:`, error);
          }
          // Continue with other sessions
        }
      }));
    }

    // Filter to only completed sessions
    const sessions = allSessions.filter(s => s.isCompleted);

    if (sessions.length === 0) {
      return NextResponse.json({
        bankId,
        bankTitle: bank.title,
        totalSessions: 0,
        totalQuestions: 0,
        aggregatedCommonMistakes: [],
        aggregatedWeakTags: [],
        aggregatedStrongTags: [],
        aggregatedRecommendedFocus: [],
        aggregatedPerformanceByTag: {},
        averageOverallScore: null,
        sessions: [],
      });
    }

    // Aggregate all summaries
    const summaries = sessions
      .map((s) => s.summary)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (summaries.length === 0) {
      return NextResponse.json({
        bankId,
        bankTitle: bank.title,
        totalSessions: sessions.length,
        totalQuestions: sessions.reduce((sum, s) => sum + s.items.length, 0),
        aggregatedCommonMistakes: [],
        aggregatedWeakTags: [],
        aggregatedStrongTags: [],
        aggregatedRecommendedFocus: [],
        aggregatedPerformanceByTag: {},
        averageOverallScore: null,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          completedAt: s.completedAt,
          overallScore: s.summary?.overallScore || null,
        })),
      });
    }

    // Aggregate common mistakes
    const mistakeFrequency: Map<string, { frequency: number; examples: Set<string> }> = new Map();
    summaries.forEach((summary) => {
      const mistakes = summary.commonMistakes as Array<{ pattern: string; frequency: number; examples: string[] }> | null;
      if (mistakes && Array.isArray(mistakes)) {
        mistakes.forEach((mistake) => {
          const normalized = mistake.pattern.toLowerCase().trim();
          if (!mistakeFrequency.has(normalized)) {
            mistakeFrequency.set(normalized, { frequency: 0, examples: new Set() });
          }
          const entry = mistakeFrequency.get(normalized)!;
          entry.frequency += mistake.frequency;
          mistake.examples.forEach((ex) => entry.examples.add(ex));
        });
      }
    });

    const aggregatedCommonMistakes = Array.from(mistakeFrequency.entries())
      .map(([pattern, data]) => ({
        pattern,
        frequency: data.frequency,
        examples: Array.from(data.examples).slice(0, 3),
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Aggregate tags
    const tagFrequency: Map<string, { weak: number; strong: number; focus: number; scores: number[] }> = new Map();
    let totalOverallScore = 0;
    let totalOverallScoreCount = 0;

    summaries.forEach((summary) => {
      // Count weak tags
      summary.weakTags.forEach((tag) => {
        if (!tagFrequency.has(tag)) {
          tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0, scores: [] });
        }
        tagFrequency.get(tag)!.weak++;
      });

      // Count strong tags
      summary.strongTags.forEach((tag) => {
        if (!tagFrequency.has(tag)) {
          tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0, scores: [] });
        }
        tagFrequency.get(tag)!.strong++;
      });

      // Count recommended focus
      summary.recommendedFocus.forEach((tag) => {
        if (!tagFrequency.has(tag)) {
          tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0, scores: [] });
        }
        tagFrequency.get(tag)!.focus++;
      });

      // Aggregate performance by tag
      const performanceByTag = summary.performanceByTag as Record<string, { avgScore: number; count: number }> | null;
      if (performanceByTag && typeof performanceByTag === 'object') {
        Object.entries(performanceByTag).forEach(([tag, data]) => {
          if (!tagFrequency.has(tag)) {
            tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0, scores: [] });
          }
          tagFrequency.get(tag)!.scores.push(data.avgScore);
        });
      }

      // Track overall scores
      if (summary.overallScore !== null) {
        totalOverallScore += summary.overallScore;
        totalOverallScoreCount++;
      }
    });

    // Determine aggregated weak/strong tags (tags that appear in >50% of summaries)
    const threshold = summaries.length * 0.5;
    const aggregatedWeakTags: string[] = [];
    const aggregatedStrongTags: string[] = [];

    tagFrequency.forEach((counts, tag) => {
      if (counts.weak > threshold) {
        aggregatedWeakTags.push(tag);
      }
      if (counts.strong > threshold) {
        aggregatedStrongTags.push(tag);
      }
    });

    // Top focus areas (tags with highest focus count)
    const aggregatedRecommendedFocus = Array.from(tagFrequency.entries())
      .filter(([, counts]) => counts.focus > 0)
      .sort((a, b) => b[1].focus - a[1].focus)
      .slice(0, 5)
      .map(([tag]) => tag);

    // Aggregate performance by tag (average of all session averages)
    const aggregatedPerformanceByTag: Record<string, { avgScore: number; sessionCount: number }> = {};
    tagFrequency.forEach((data, tag) => {
      if (data.scores.length > 0) {
        const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
        aggregatedPerformanceByTag[tag] = {
          avgScore: Math.round(avgScore * 10) / 10,
          sessionCount: data.scores.length,
        };
      }
    });

    const averageOverallScore = totalOverallScoreCount > 0
      ? Math.round((totalOverallScore / totalOverallScoreCount) * 10) / 10
      : null;

    // Calculate total questions across all sessions
    const totalQuestions = sessions.reduce((sum, s) => sum + s.items.length, 0);

    return NextResponse.json({
      bankId,
      bankTitle: bank.title,
      totalSessions: sessions.length,
      totalQuestions,
      aggregatedCommonMistakes,
      aggregatedWeakTags,
      aggregatedStrongTags,
      aggregatedRecommendedFocus,
      aggregatedPerformanceByTag,
      averageOverallScore,
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        completedAt: s.completedAt,
        overallScore: s.summary?.overallScore || null,
        questionCount: s.items.length,
      })),
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

