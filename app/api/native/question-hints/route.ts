import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';

/** A hint is the answer or key points a learner wrote on the back of a card. Bounded so one bank cannot bloat the response. */
const MAX_HINTS = 3000;
const MAX_HINT_CHARS = 4000;

/**
 * The signed-in device's own question hints, keyed by question text. The phone's banks carry local ids with no
 * link to server questions, so the text is the join key; the device matches it after normalising whitespace and case.
 *
 * Only questions in banks the learner OWNS are returned (shared or public banks have no hint here), archived
 * questions are left out, and the learner is derived from the device token. Returned for on-device feedback only:
 * "which of your own key points did this answer miss".
 */
export async function GET(request: NextRequest) {
  try {
    const { user, device } = await requireDevice(request);
    await enforceRateLimit({ key: `native-question-hints:device:${device.id}`, limit: 30, windowMs: 60_000 });

    const rows = await prisma.question.findMany({
      where: { archivedAt: null, hint: { not: null }, bank: { userId: user.id } },
      select: { text: true, hint: true },
      orderBy: { id: 'asc' },
      take: MAX_HINTS,
    });
    const seen = new Set<string>();
    const hints: Array<{ text: string; hint: string }> = [];
    for (const r of rows) {
      const hint = r.hint?.trim();
      if (!hint) continue;
      const key = r.text.trim().toLowerCase().split(/\s+/).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push({ text: r.text, hint: hint.slice(0, MAX_HINT_CHARS) });
    }

    return NextResponse.json({ hints }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
