import { prisma } from './db';

interface CommonMistake {
  pattern: string;
  frequency: number;
  examples: string[];
}

interface PerformanceByTag {
  [tag: string]: {
    avgScore: number;
    count: number;
    questions: string[];
  };
}

export async function analyzeSessionPerformance(
  sessionId: string,
  userId: string
): Promise<{
  commonMistakes: CommonMistake[];
  weakTags: string[];
  strongTags: string[];
  recommendedFocus: string[];
  performanceByTag: PerformanceByTag;
  overallScore: number;
}> {
  // Get all session items with questions
  const session = await prisma.session.findUnique({
    where: { id: sessionId, userId },
    include: {
      items: {
        include: {
          question: true,
        },
      },
    },
  });

  if (!session) {
    throw new Error('Session not found');
  }

  const items = session.items;
  if (items.length === 0) {
    return {
      commonMistakes: [],
      weakTags: [],
      strongTags: [],
      recommendedFocus: [],
      performanceByTag: {},
      overallScore: 0,
    };
  }

  // Collect all mistakes from whatWasWrong arrays
  const mistakeFrequency: Map<string, number> = new Map();
  const mistakeExamples: Map<string, Set<string>> = new Map();

  items.forEach((item) => {
    if (item.whatWasWrong && item.whatWasWrong.length > 0) {
      item.whatWasWrong.forEach((mistake) => {
        const normalized = mistake.toLowerCase().trim();
        mistakeFrequency.set(normalized, (mistakeFrequency.get(normalized) || 0) + 1);
        if (!mistakeExamples.has(normalized)) {
          mistakeExamples.set(normalized, new Set());
        }
        mistakeExamples.get(normalized)?.add(mistake);
      });
    }
  });

  // Convert to common mistakes array
  const commonMistakes: CommonMistake[] = Array.from(mistakeFrequency.entries())
    .map(([pattern, frequency]) => ({
      pattern,
      frequency,
      examples: Array.from(mistakeExamples.get(pattern) || []).slice(0, 3),
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10); // Top 10 most common

  // Calculate performance by tag
  const tagScores: Map<string, number[]> = new Map();
  const tagQuestions: Map<string, Set<string>> = new Map();

  items.forEach((item) => {
    const question = item.question;
    const tags = question.tags || [];
    
    // Calculate average score for this item
    const scores = [
      item.starScore,
      item.impactScore,
      item.clarityScore,
      item.technicalAccuracy,
      item.terminologyUsage,
    ].filter((s): s is number => s !== null && s !== undefined);
    
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    tags.forEach((tag) => {
      if (!tagScores.has(tag)) {
        tagScores.set(tag, []);
        tagQuestions.set(tag, new Set());
      }
      tagScores.get(tag)?.push(avgScore);
      tagQuestions.get(tag)?.add(question.id);
    });
  });

  // Build performance by tag object
  const performanceByTag: PerformanceByTag = {};
  Array.from(tagScores.entries()).forEach(([tag, scores]) => {
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    performanceByTag[tag] = {
      avgScore: Math.round(avgScore * 10) / 10, // Round to 1 decimal
      count: scores.length,
      questions: Array.from(tagQuestions.get(tag) || []),
    };
  });

  // Identify weak tags (avg score < 3) and strong tags (avg score >= 4)
  const weakTags: string[] = [];
  const strongTags: string[] = [];

  Object.entries(performanceByTag).forEach(([tag, data]) => {
    if (data.avgScore < 3) {
      weakTags.push(tag);
    } else if (data.avgScore >= 4) {
      strongTags.push(tag);
    }
  });

  // Generate recommended focus areas (weak tags sorted by frequency/importance)
  const recommendedFocus = weakTags
    .sort((a, b) => {
      const aData = performanceByTag[a];
      const bData = performanceByTag[b];
      // Sort by count (more questions = more important) then by score (lower = more important)
      if (aData.count !== bData.count) {
        return bData.count - aData.count;
      }
      return aData.avgScore - bData.avgScore;
    })
    .slice(0, 5); // Top 5 focus areas

  // Calculate overall score
  const allScores: number[] = [];
  items.forEach((item) => {
    const scores = [
      item.starScore,
      item.impactScore,
      item.clarityScore,
      item.technicalAccuracy,
      item.terminologyUsage,
    ].filter((s): s is number => s !== null && s !== undefined);
    allScores.push(...scores);
  });

  const overallScore = allScores.length > 0
    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
    : 0;

  return {
    commonMistakes,
    weakTags,
    strongTags,
    recommendedFocus,
    performanceByTag,
    overallScore,
  };
}

export async function aggregateUserInsights(userId: string): Promise<void> {
  // Get all completed sessions for user
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      isCompleted: true,
    },
    include: {
      summary: true,
      items: true,
    },
  });

  if (sessions.length === 0) {
    // Create empty insight record
    await prisma.userLearningInsight.upsert({
      where: { userId },
      create: {
        userId,
        aggregatedWeakTags: [],
        aggregatedStrongTags: [],
        topFocusAreas: [],
        totalSessions: 0,
        totalQuestions: 0,
      },
      update: {
        aggregatedWeakTags: [],
        aggregatedStrongTags: [],
        topFocusAreas: [],
        totalSessions: 0,
        totalQuestions: 0,
        lastUpdated: new Date(),
      },
    });
    return;
  }

  // Aggregate all summaries
  const summaries = sessions
    .map((s) => s.summary)
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (summaries.length === 0) {
    return;
  }

  // Collect all tags
  const tagFrequency: Map<string, { weak: number; strong: number; focus: number }> = new Map();
  let totalQuestions = 0;

  summaries.forEach((summary) => {
    // Count weak tags
    summary.weakTags.forEach((tag) => {
      if (!tagFrequency.has(tag)) {
        tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
      }
      tagFrequency.get(tag)!.weak++;
    });

    // Count strong tags
    summary.strongTags.forEach((tag) => {
      if (!tagFrequency.has(tag)) {
        tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
      }
      tagFrequency.get(tag)!.strong++;
    });

    // Count recommended focus
    summary.recommendedFocus.forEach((tag) => {
      if (!tagFrequency.has(tag)) {
        tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
      }
      tagFrequency.get(tag)!.focus++;
    });
  });

  // Calculate total questions
  sessions.forEach((session) => {
    totalQuestions += session.items?.length || 0;
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
  const topFocusAreas = Array.from(tagFrequency.entries())
    .filter(([, counts]) => counts.focus > 0)
    .sort((a, b) => b[1].focus - a[1].focus)
    .slice(0, 5)
    .map(([tag]) => tag);

  // Update or create insight record
  await prisma.userLearningInsight.upsert({
    where: { userId },
    create: {
      userId,
      aggregatedWeakTags,
      aggregatedStrongTags,
      topFocusAreas,
      totalSessions: sessions.length,
      totalQuestions,
    },
    update: {
      aggregatedWeakTags,
      aggregatedStrongTags,
      topFocusAreas,
      totalSessions: sessions.length,
      totalQuestions,
      lastUpdated: new Date(),
    },
  });
}

