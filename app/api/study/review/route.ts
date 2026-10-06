import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getReviewQueue } from "@/lib/study-tracker";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAccess(request, 'review:read');
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;

    const queue = await getReviewQueue(user.id, limit);

    return NextResponse.json({ queue, total: queue.length });
  } catch (error) {
    const e = handleApiError(error);
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
}
