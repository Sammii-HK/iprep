import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handleApiError, ValidationError } from "@/lib/errors";
import {
  getDailyProgress,
  getDaysUntilInterview,
  getDailyQuota,
} from "@/lib/study-tracker";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        currentStreak: true,
        longestStreak: true,
        dailyGoal: true,
        interviewDate: true,
        lastStudiedDate: true,
      },
    });

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [dailyProgress, reviewDueCount, dailyQuota] = await Promise.all([
      getDailyProgress(user.id),
      prisma.userQuestionProgress.count({
        where: { userId: user.id, nextReviewAt: { lte: new Date() } },
      }),
      getDailyQuota(user.id, userData.interviewDate),
    ]);

    return NextResponse.json({
      currentStreak: userData.currentStreak,
      longestStreak: userData.longestStreak,
      dailyGoal: userData.dailyGoal,
      dailyProgress,
      interviewDate: userData.interviewDate?.toISOString() ?? null,
      daysUntilInterview: getDaysUntilInterview(userData.interviewDate),
      reviewDueCount,
      dailyQuota,
    });
  } catch (error) {
    const e = handleApiError(error);
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const updates: {
      dailyGoal?: number;
      interviewDate?: Date | null;
    } = {};

    if (body.dailyGoal !== undefined) {
      const goal = Number(body.dailyGoal);
      if (!Number.isInteger(goal) || goal < 1 || goal > 100) {
        throw new ValidationError("dailyGoal must be an integer between 1 and 100");
      }
      updates.dailyGoal = goal;
    }

    if ("interviewDate" in body) {
      if (body.interviewDate === null) {
        updates.interviewDate = null;
      } else {
        const d = new Date(body.interviewDate);
        if (isNaN(d.getTime())) {
          throw new ValidationError("Invalid interviewDate");
        }
        updates.interviewDate = d;
      }
    }

    await prisma.user.update({ where: { id: user.id }, data: updates });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = handleApiError(error);
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
}
