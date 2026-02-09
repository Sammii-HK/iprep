import { getConfig } from "@/lib/config";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

interface RateLimitBackend {
  get(key: string): Promise<RateLimitRecord | null>;
  set(key: string, record: RateLimitRecord): Promise<void>;
}

// In-memory backend (default, resets on deploy)
class MemoryBackend implements RateLimitBackend {
  private store = new Map<string, RateLimitRecord>();

  async get(key: string): Promise<RateLimitRecord | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, record: RateLimitRecord): Promise<void> {
    this.store.set(key, record);
    // Prevent unbounded memory growth - clean up expired entries periodically
    if (this.store.size > 10000) {
      const now = Date.now();
      for (const [k, v] of this.store) {
        if (now > v.resetTime) this.store.delete(k);
      }
    }
  }
}

// KV backend (Vercel KV / Redis) - only used when KV_REST_API_URL is set
class KVBackend implements RateLimitBackend {
  private kv: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<unknown> } | null = null;

  private async getClient() {
    if (!this.kv) {
      try {
        // @ts-expect-error - @vercel/kv is an optional dependency
        const mod = await import("@vercel/kv");
        this.kv = mod.kv;
      } catch {
        console.warn("@vercel/kv not installed, falling back to memory backend");
        return null;
      }
    }
    return this.kv;
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    const client = await this.getClient();
    if (!client) return null;
    const record = await client.get(`ratelimit:${key}`);
    return record as RateLimitRecord | null;
  }

  async set(key: string, record: RateLimitRecord): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const ttlMs = record.resetTime - Date.now();
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await client.set(`ratelimit:${key}`, record, { ex: ttlSec });
  }
}

// Select backend based on environment
function createBackend(): RateLimitBackend {
  if (process.env.KV_REST_API_URL) {
    return new KVBackend();
  }
  return new MemoryBackend();
}

const backend = createBackend();

/**
 * Check rate limit for a given key (typically IP address).
 * Returns true if the request is allowed, false if rate limited.
 */
export async function checkRateLimit(key: string): Promise<boolean> {
  const { rateLimitRequests, rateLimitWindowMs } = getConfig().limits;
  const now = Date.now();

  try {
    const record = await backend.get(key);

    if (!record || now > record.resetTime) {
      await backend.set(key, {
        count: 1,
        resetTime: now + rateLimitWindowMs,
      });
      return true;
    }

    if (record.count >= rateLimitRequests) {
      return false;
    }

    await backend.set(key, {
      count: record.count + 1,
      resetTime: record.resetTime,
    });
    return true;
  } catch (error) {
    // If rate limiting fails (e.g., KV down), allow the request
    console.error("Rate limit check failed:", error);
    return true;
  }
}
