/**
 * Durable rate limiting.
 *
 * Counters live in Postgres (table RateLimitBucket), so a limit holds across serverless instances and
 * deploys, and no extra service is needed. A hit is one atomic upsert, so concurrent requests cannot slip
 * past a limit. This is the minimum durable primitive for the security boundary; the AI usage and cost
 * accounting from section S of the vNext plan builds on the same keys.
 *
 * Policy:
 *  - security and expensive routes FAIL CLOSED: if the counter store is unavailable the request is refused
 *    (503) rather than allowed through;
 *  - the client IP comes only from headers the platform sets (never a raw, client-extendable
 *    X-Forwarded-For list);
 *  - authenticated routes are keyed by user id, not by IP.
 */
import type { NextRequest } from 'next/server';
import { AppError, RateLimitError } from '@/lib/errors';

export interface RateLimitStore {
  /** Count one hit in the window containing `now` and return the count including this hit. */
  hit(key: string, windowMs: number, now: number): Promise<number>;
}

class PostgresStore implements RateLimitStore {
  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const { prisma } = await import('@/lib/db');
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    // Opportunistic cleanup of old windows (about 1 in 200 hits); failure here never affects the request.
    if (Math.random() < 0.005) {
      void prisma
        .$executeRaw`DELETE FROM "RateLimitBucket" WHERE "windowStart" < ${new Date(now - 2 * 24 * 60 * 60 * 1000)}`
        .catch(() => undefined);
    }
    return Number(rows[0].count);
  }
}

/** In-memory store for tests. Never used in production code paths. */
export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, number>();
  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const id = `${key}@${Math.floor(now / windowMs)}`;
    const next = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, next);
    return next;
  }
}

let defaultStore: RateLimitStore = new PostgresStore();

/** Test hook. */
export function setRateLimitStore(store: RateLimitStore): void {
  defaultStore = store;
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  /** Refuse (503) when the counter store is unavailable. Default true. */
  failClosed?: boolean;
  store?: RateLimitStore;
  now?: number;
}

/** Throws RateLimitError (429) when the limit is exceeded. */
export async function enforceRateLimit(opts: RateLimitOptions): Promise<void> {
  const { key, limit, windowMs, failClosed = true, store = defaultStore, now = Date.now() } = opts;
  let count: number;
  try {
    count = await store.hit(key, windowMs, now);
  } catch (error) {
    console.error('Rate limit store unavailable:', error instanceof Error ? error.message : 'unknown error');
    if (failClosed) throw new AppError('Service temporarily unavailable. Please try again shortly.', 503, 'RATE_LIMIT_UNAVAILABLE');
    return;
  }
  if (count > limit) throw new RateLimitError('Too many requests. Please try again later.');
}

/**
 * Client IP from platform-set headers only. On Vercel, x-vercel-forwarded-for and x-real-ip are set by the
 * platform and cannot be overridden by the client. A raw X-Forwarded-For list is never used because a client can
 * prepend values to it. Self-hosting behind a proxy must set x-real-ip at the proxy.
 */
export function clientIp(request: Pick<NextRequest, 'headers'>): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercel) return vercel;
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}

/** Route-class policies. Values are deliberately modest for a single-learner product. */
export const LIMITS = {
  loginIp: { limit: 20, windowMs: 15 * 60_000 },
  loginAccount: { limit: 8, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  /** Expensive model-backed routes, per signed-in user. */
  aiBurst: { limit: 10, windowMs: 60_000 },
  aiHourly: { limit: 120, windowMs: 60 * 60_000 },
  interviews: { limit: 60, windowMs: 60_000 },
  push: { limit: 10, windowMs: 60_000 },
} as const;

/** Both the burst and the hourly limit for an expensive route, keyed by user. */
export async function enforceAiLimits(route: string, userId: string): Promise<void> {
  await enforceRateLimit({ key: `ai:${route}:${userId}:burst`, ...LIMITS.aiBurst });
  await enforceRateLimit({ key: `ai:${route}:${userId}:hour`, ...LIMITS.aiHourly });
}
