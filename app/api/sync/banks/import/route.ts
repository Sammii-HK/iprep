import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError, readJson } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { BankImportSchema, importCustomBank } from '@/lib/sync/bankImport';

/** Explicit, idempotent upload of a custom iOS bank. See docs/P2_NATIVE_SYNC.md section 2.7. */
export async function POST(request: NextRequest) {
  try {
    const { user, device } = await requireDevice(request);
    await enforceRateLimit({ key: `sync-bank-import:device:${device.id}`, limit: 20, windowMs: 60 * 60_000 });
    const body = BankImportSchema.parse(await readJson(request, 1_500_000));
    return NextResponse.json(await importCustomBank(prisma, user.id, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
