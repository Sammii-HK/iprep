/**
 * Simple in-memory cache for transcript analyses
 * Upgrade to Redis in production for multi-instance deployments
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class AnalysisCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Generate cache key from transcript and question context
   */
  private generateKey(
    transcript: string,
    questionId: string,
    questionTags: string[],
    preferences?: Record<string, unknown>
  ): string {
    // Normalize transcript (lowercase, trim whitespace)
    const normalizedTranscript = transcript.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Create a hash-like key from transcript (first 100 chars + length + hash of full)
    const transcriptHash = this.simpleHash(normalizedTranscript);
    const transcriptKey = `${normalizedTranscript.substring(0, 100)}:${normalizedTranscript.length}:${transcriptHash}`;
    
    // Include question context
    const tagsKey = questionTags.sort().join(',');
    const prefsKey = preferences ? JSON.stringify(preferences) : 'default';
    
    return `${questionId}:${tagsKey}:${prefsKey}:${transcriptKey}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get cached analysis
   */
  get<T>(
    transcript: string,
    questionId: string,
    questionTags: string[],
    preferences?: Record<string, unknown>
  ): T | null {
    const key = this.generateKey(transcript, questionId, questionTags, preferences);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cached analysis
   */
  set<T>(
    transcript: string,
    questionId: string,
    questionTags: string[],
    data: T,
    ttl: number = this.DEFAULT_TTL,
    preferences?: Record<string, unknown>
  ): void {
    const key = this.generateKey(transcript, questionId, questionTags, preferences);
    
    // Limit cache size (keep last 1000 entries)
    if (this.cache.size >= 1000) {
      // Remove oldest 100 entries
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100);
      entries.forEach(([k]) => this.cache.delete(k));
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Clear cache (useful for testing or manual invalidation)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }
}

// Export singleton instance
export const analysisCache = new AnalysisCache();

