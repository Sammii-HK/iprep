import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getReviewQueue } from "@/lib/study-tracker";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);

    const queue = await getReviewQueue(user.id, limit);

    return NextResponse.json({ queue, total: queue.length });
  } catch (error) {
    const e = handleApiError(error);
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
}
