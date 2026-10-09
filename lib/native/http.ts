import { NextResponse } from 'next/server';
import { handleApiError } from '../errors';

/** Details that are part of the documented contract and safe for the signed-in caller to see in production. */
const PUBLIC_DETAIL_CODES = new Set(['ACCOUNT_DELETION_PENDING', 'EPOCH_CHANGED']);

export function nativeError(error: unknown): NextResponse {
  const handled = handleApiError(error);
  const details =
    handled.code && PUBLIC_DETAIL_CODES.has(handled.code) && error && typeof error === 'object' && 'details' in error
      ? (error as { details?: unknown }).details
      : handled.details;
  return NextResponse.json(
    { error: handled.message, code: handled.code, ...(details ? { details } : {}) },
    { status: handled.statusCode }
  );
}

export async function readJson(request: Request, maxBytes = 1_000_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) {
    const { AppError } = await import('../errors');
    throw new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
  }
  try {
    return JSON.parse(text);
  } catch {
    const { ValidationError } = await import('../errors');
    throw new ValidationError('Request body must be valid JSON');
  }
}
