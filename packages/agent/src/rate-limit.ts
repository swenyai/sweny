interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private maxPerMinute: number;
  private maxPerHour: number;

  constructor(maxPerMinute = 10, maxPerHour = 50) {
    this.maxPerMinute = maxPerMinute;
    this.maxPerHour = maxPerHour;
  }

  check(userId: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const entry = this.entries.get(userId) ?? { timestamps: [] };

    // Prune timestamps older than 1 hour
    entry.timestamps = entry.timestamps.filter((t) => now - t < 60 * 60 * 1000);

    const lastMinute = entry.timestamps.filter((t) => now - t < 60 * 1000);

    if (lastMinute.length >= this.maxPerMinute) {
      const oldest = lastMinute[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + 60 * 1000 - now) / 1000) };
    }

    if (entry.timestamps.length >= this.maxPerHour) {
      const oldest = entry.timestamps[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + 60 * 60 * 1000 - now) / 1000) };
    }

    entry.timestamps.push(now);
    this.entries.set(userId, entry);
    return { allowed: true };
  }
}
