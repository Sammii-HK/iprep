import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const searchParams = request.nextUrl.searchParams;
    const range = parseInt(searchParams.get('range') || '30', 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - range);

    // Get all session items in the date range for this user
    const items = await prisma.sessionItem.findMany({
      where: {
        session: {
          userId: user.id,
        },
        createdAt: {
          gte: startDate,
        },
      },
      include: {
        question: true,
      },
    });

    if (items.length === 0) {
      return NextResponse.json({
        avgWPM: 0,
        avgFillerRate: 0,
        avgConfidence: 0,
        avgIntonation: 0,
        avgStar: 0,
        avgImpact: 0,
        avgClarity: 0,
        weakestTags: [],
        trends: {
          wpm: [],
          fillerRate: [],
        },
      });
    }

    // Calculate averages
    const validWPM = items.filter((i) => i.wpm !== null).map((i) => i.wpm!);
    const validFillerRate = items
      .filter((i) => i.fillerRate !== null)
      .map((i) => i.fillerRate!);
    const validConfidence = items
      .filter((i) => i.confidenceScore !== null)
      .map((i) => i.confidenceScore!);
    const validIntonation = items
      .filter((i) => i.intonationScore !== null)
      .map((i) => i.intonationScore!);
    const validStar = items
      .filter((i) => i.starScore !== null)
      .map((i) => i.starScore!);
    const validImpact = items
      .filter((i) => i.impactScore !== null)
      .map((i) => i.impactScore!);
    const validClarity = items
      .filter((i) => i.clarityScore !== null)
      .map((i) => i.clarityScore!);

    const avgWPM =
      validWPM.length > 0
        ? validWPM.reduce((a: number, b: number) => a + b, 0) / validWPM.length
        : 0;
    const avgFillerRate =
      validFillerRate.length > 0
        ? validFillerRate.reduce((a: number, b: number) => a + b, 0) / validFillerRate.length
        : 0;
    const avgConfidence =
      validConfidence.length > 0
        ? validConfidence.reduce((a: number, b: number) => a + b, 0) / validConfidence.length
        : 0;
    const avgIntonation =
      validIntonation.length > 0
        ? validIntonation.reduce((a: number, b: number) => a + b, 0) / validIntonation.length
        : 0;
    const avgStar =
      validStar.length > 0 ? validStar.reduce((a: number, b: number) => a + b, 0) / validStar.length : 0;
    const avgImpact =
      validImpact.length > 0
        ? validImpact.reduce((a: number, b: number) => a + b, 0) / validImpact.length
        : 0;
    const avgClarity =
      validClarity.length > 0
        ? validClarity.reduce((a: number, b: number) => a + b, 0) / validClarity.length
        : 0;

    // Calculate weakest tags (tags with lowest average scores)
    const tagScores: Record<string, number[]> = {};
    items.forEach((item) => {
      item.question.tags.forEach((tag: string) => {
        if (!tagScores[tag]) {
          tagScores[tag] = [];
        }
        const totalScore =
          (item.starScore || 0) +
          (item.impactScore || 0) +
          (item.clarityScore || 0) +
          (item.confidenceScore || 0) +
          (item.intonationScore || 0);
        tagScores[tag].push(totalScore);
      });
    });

    const tagAverages = Object.entries(tagScores).map(([tag, scores]) => ({
      tag,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }));

    const weakestTags = tagAverages
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 5)
      .map((t) => t.tag);

    // Calculate daily trends (simplified - group by day)
    const dailyData: Record<string, { wpm: number[]; fillerRate: number[] }> = {};
    items.forEach((item) => {
      const date = item.createdAt.toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = { wpm: [], fillerRate: [] };
      }
      if (item.wpm !== null) dailyData[date].wpm.push(item.wpm);
      if (item.fillerRate !== null) dailyData[date].fillerRate.push(item.fillerRate);
    });

    const trends = {
      wpm: Object.entries(dailyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          value:
            data.wpm.length > 0
              ? data.wpm.reduce((a, b) => a + b, 0) / data.wpm.length
              : 0,
        })),
      fillerRate: Object.entries(dailyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          value:
            data.fillerRate.length > 0
              ? data.fillerRate.reduce((a, b) => a + b, 0) / data.fillerRate.length
              : 0,
        })),
    };

    return NextResponse.json({
      avgWPM: Math.round(avgWPM),
      avgFillerRate: parseFloat(avgFillerRate.toFixed(2)),
      avgConfidence: parseFloat(avgConfidence.toFixed(2)),
      avgIntonation: parseFloat(avgIntonation.toFixed(2)),
      avgStar: parseFloat(avgStar.toFixed(2)),
      avgImpact: parseFloat(avgImpact.toFixed(2)),
      avgClarity: parseFloat(avgClarity.toFixed(2)),
      weakestTags,
      trends,
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
