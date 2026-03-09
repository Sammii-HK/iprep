/**
 * Study tracking: streaks, daily goals, and spaced repetition (SM-2).
 */

import { prisma } from "./db";

// ─── Streak ───────────────────────────────────────────────────────────────────

/**
 * Call after any completed practice item. Updates streak and daily goal progress.
 */
export async function updateStudyStreak(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentStreak: true, longestStreak: true, lastStudiedDate: true },
  });
  if (!user) return;

  const today = startOfDayUTC();
  const lastDate = user.lastStudiedDate
    ? startOfDayUTC(user.lastStudiedDate)
    : null;

  let newStreak = user.currentStreak;

  if (!lastDate) {
    // First ever study
    newStreak = 1;
  } else {
    const daysDiff = daysBetween(lastDate, today);
    if (daysDiff === 0) {
      // Already studied today — no streak change
      return;
    } else if (daysDiff === 1) {
      // Consecutive day
      newStreak = user.currentStreak + 1;
    } else {
      // Streak broken
      newStreak = 1;
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      currentStreak: newStreak,
      longestStreak: Math.max(newStreak, user.longestStreak),
      lastStudiedDate: today,
    },
  });
}

// ─── Daily goal progress ──────────────────────────────────────────────────────

/**
 * How many questions answered today (across all sessions).
 */
export async function getDailyProgress(userId: string): Promise<number> {
  const today = startOfDayUTC();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const count = await prisma.sessionItem.count({
    where: {
      session: { userId },
      createdAt: { gte: today, lt: tomorrow },
    },
  });
  return count;
}

// ─── Interview countdown ──────────────────────────────────────────────────────

export function getDaysUntilInterview(interviewDate: Date | null): number | null {
  if (!interviewDate) return null;
  const today = startOfDayUTC();
  const target = startOfDayUTC(interviewDate);
  return Math.max(0, daysBetween(today, target));
}

/**
 * Estimated questions due for review + unreviewed weak questions,
 * divided by days remaining. Returns recommended daily quota.
 */
export async function getDailyQuota(
  userId: string,
  interviewDate: Date | null
): Promise<number | null> {
  const daysLeft = getDaysUntilInterview(interviewDate);
  if (!daysLeft || daysLeft === 0) return null;

  const [dueReview, weakUnpractised] = await Promise.all([
    prisma.userQuestionProgress.count({
      where: { userId, nextReviewAt: { lte: new Date() } },
    }),
    // Questions in user's banks with no progress record yet
    prisma.question.count({
      where: {
        bank: { userId },
        userProgress: { none: { userId } },
      },
    }),
  ]);

  const total = dueReview + weakUnpractised;
  return Math.ceil(total / daysLeft);
}

// ─── Spaced Repetition (SM-2) ─────────────────────────────────────────────────

/**
 * Update spaced repetition progress after a practice answer.
 * score: answerQuality from AI (0–10). Maps to SM-2 quality (0–5).
 */
export async function updateSRSProgress(
  userId: string,
  questionId: string,
  score: number // 0–10
): Promise<void> {
  const quality = scoreToSM2Quality(score);

  const existing = await prisma.userQuestionProgress.findUnique({
    where: { userId_questionId: { userId, questionId } },
  });

  const prev = existing ?? { interval: 1, easeFactor: 2.5, repetitions: 0 };

  let { interval, easeFactor, repetitions } = prev;

  if (quality >= 3) {
    // Successful recall
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);

    easeFactor = Math.max(
      1.3,
      easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    );
    repetitions += 1;
  } else {
    // Failed — reset
    interval = 1;
    repetitions = 0;
    // easeFactor stays (penalised on next success)
  }

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  await prisma.userQuestionProgress.upsert({
    where: { userId_questionId: { userId, questionId } },
    create: {
      userId,
      questionId,
      interval,
      easeFactor,
      repetitions,
      lastScore: score,
      lastPracticed: new Date(),
      nextReviewAt,
    },
    update: {
      interval,
      easeFactor,
      repetitions,
      lastScore: score,
      lastPracticed: new Date(),
      nextReviewAt,
    },
  });
}

/**
 * Get questions due for review today, ordered by most overdue first.
 */
export async function getReviewQueue(
  userId: string,
  limit = 20
): Promise<Array<{
  questionId: string;
  questionText: string;
  questionHint: string | null;
  tags: string[];
  difficulty: number;
  bankTitle: string;
  lastScore: number | null;
  daysOverdue: number;
}>> {
  const now = new Date();

  const due = await prisma.userQuestionProgress.findMany({
    where: { userId, nextReviewAt: { lte: now } },
    orderBy: { nextReviewAt: "asc" },
    take: limit,
    include: {
      question: {
        select: {
          text: true,
          hint: true,
          tags: true,
          difficulty: true,
          bank: { select: { title: true } },
        },
      },
    },
  });

  return due.map((p) => ({
    questionId: p.questionId,
    questionText: p.question.text,
    questionHint: p.question.hint,
    tags: p.question.tags,
    difficulty: p.question.difficulty,
    bankTitle: p.question.bank.title,
    lastScore: p.lastScore,
    daysOverdue: Math.floor((now.getTime() - p.nextReviewAt.getTime()) / 86400000),
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDayUTC(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Map 0–10 score to SM-2 quality 0–5 */
function scoreToSM2Quality(score: number): number {
  if (score >= 9) return 5;
  if (score >= 7) return 4;
  if (score >= 5) return 3;
  if (score >= 3) return 2;
  if (score >= 1) return 1;
  return 0;
}
