import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the per-minute limit", () => {
    limiter = new RateLimiter(3, 100);

    expect(limiter.check("user1")).toEqual({ allowed: true });
    expect(limiter.check("user1")).toEqual({ allowed: true });
    expect(limiter.check("user1")).toEqual({ allowed: true });
  });

  it("blocks requests over the per-minute limit", () => {
    limiter = new RateLimiter(2, 100);

    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(true);

    const result = limiter.check("user1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeDefined();
  });

  it("blocks requests over the per-hour limit", () => {
    limiter = new RateLimiter(100, 3);

    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(true);

    // Advance past the 1-minute window so per-minute limit resets,
    // but still within the hour window
    vi.advanceTimersByTime(61_000);

    const result = limiter.check("user1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeDefined();
    expect(result.retryAfterSeconds!).toBeGreaterThan(0);
  });

  it("returns correct retryAfterSeconds when blocked by per-minute limit", () => {
    limiter = new RateLimiter(1, 100);

    expect(limiter.check("user1").allowed).toBe(true);

    // Advance 30 seconds — still within the 60-second window
    vi.advanceTimersByTime(30_000);

    const result = limiter.check("user1");
    expect(result.allowed).toBe(false);
    // The oldest timestamp was at time 0, so retryAfter = ceil((0 + 60000 - 30000) / 1000) = 30
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("different users have independent limits", () => {
    limiter = new RateLimiter(1, 100);

    expect(limiter.check("alice").allowed).toBe(true);
    expect(limiter.check("bob").allowed).toBe(true);

    // Alice is blocked, but Bob already used his
    expect(limiter.check("alice").allowed).toBe(false);
    expect(limiter.check("bob").allowed).toBe(false);

    // New user Charlie is still fine
    expect(limiter.check("charlie").allowed).toBe(true);
  });

  it("timestamps expire and free up capacity after one minute", () => {
    limiter = new RateLimiter(1, 100);

    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(false);

    // Advance past the 60-second window
    vi.advanceTimersByTime(61_000);

    expect(limiter.check("user1").allowed).toBe(true);
  });

  it("timestamps expire and free up capacity after one hour", () => {
    limiter = new RateLimiter(100, 2);

    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(true);

    // Advance past the minute window but still within the hour
    vi.advanceTimersByTime(61_000);
    expect(limiter.check("user1").allowed).toBe(false);

    // Advance past the full hour
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(limiter.check("user1").allowed).toBe(true);
  });
});
