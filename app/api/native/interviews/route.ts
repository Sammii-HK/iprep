import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { pickNextInterview, visibleInterviews } from '@/lib/interviews';

/** How far back a client still hears about an interview that has just finished (so a running one does not vanish). */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * The signed-in device's upcoming interviews, from the one canonical Interview table (Notion sync, manual entry and
 * later calendar import all write there). The learner is derived from the device token; the client never names it.
 *
 * Absence means "no longer upcoming": a cancelled, rescheduled-away or finished interview is simply not listed, so a
 * client that mirrors this list removes it on its next successful read. Nothing here carries a source credential,
 * the external id, notes, or another user's data.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, device } = await requireDevice(request);
    await enforceRateLimit({ key: `native-interviews:device:${device.id}`, limit: 60, windowMs: 60_000 });
    const now = new Date();

    const rows = await prisma.interview.findMany({
      where: { userId: user.id, startsAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
      orderBy: { startsAt: 'asc' },
      take: 100,
    });
    const interviews = visibleInterviews(rows, now, false).map((i) => ({
      id: i.id,
      company: i.company,
      role: i.role,
      round: i.round,
      startsAt: i.startsAt.toISOString(),
      endsAt: i.endsAt?.toISOString() ?? null,
      timeZone: i.timeZone,
      link: i.link,
      bookingLink: i.bookingLink,
      interviewer: i.interviewer,
      status: i.status,
      source: i.source,
      sourceUpdatedAt: i.sourceUpdatedAt?.toISOString() ?? null,
      updatedAt: i.updatedAt.toISOString(),
    }));
    const next = pickNextInterview(
      interviews.map((i) => ({ ...i, startsAt: new Date(i.startsAt), endsAt: i.endsAt ? new Date(i.endsAt) : null })),
      now,
    );

    return NextResponse.json(
      { serverTime: now.toISOString(), interviews, nextId: next?.id ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return nativeError(error);
  }
}
