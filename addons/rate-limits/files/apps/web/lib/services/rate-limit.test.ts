import { describe, expect, it } from "vitest";

import { userKeyPattern } from "../../db/rate-limits";
import { createRateLimiter, PRUNE_EVERY, RATE_LIMIT_KEEP_MS } from "./rate-limit";
import { runService } from "./run";

// Rate limits (/docs/features/rate-limits.md). The fake counts like the database statement: a window
// older than its length starts again at 1.

const LIMITS = { action: { max: 3, windowSeconds: 600 }, other: { max: 1, windowSeconds: 60 } };

function setup(random = () => 0.99) {
  const clock = { now: new Date("2027-01-01T12:00:00Z") };
  const rows = new Map<string, { windowStart: Date; count: number }>();
  const limiter = createRateLimiter({
    repo: {
      hit: async (key, windowSeconds, now) => {
        const row = rows.get(key);
        if (!row || row.windowStart.getTime() < now.getTime() - windowSeconds * 1000) rows.set(key, { windowStart: now, count: 1 });
        else row.count++;
        return rows.get(key)!.count;
      },
      deleteBefore: async (before) => {
        let n = 0;
        for (const [k, r] of rows) if (r.windowStart < before) n += Number(rows.delete(k));
        return n;
      },
    },
    now: () => new Date(clock.now),
    random,
    limits: LIMITS,
  });
  return { limiter, rows, clock };
}

describe("rate limits", () => {
  it("allows the limit, refuses the next with rate_limited, and allows again when the window ends", async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < LIMITS.action.max; i++) await limiter.check("action", "user_a");
    expect(await runService(() => limiter.check("action", "user_a"))).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    clock.now = new Date(clock.now.getTime() + LIMITS.action.windowSeconds * 1000 + 1);
    expect((await runService(() => limiter.check("action", "user_a"))).ok).toBe(true);
  });

  it("counts each member and each limit apart; an unknown limit name is refused", async () => {
    const { limiter, rows } = setup();
    await limiter.check("other", "user_a");
    expect((await runService(() => limiter.check("other", "user_b"))).ok).toBe(true);
    expect((await runService(() => limiter.check("action", "user_a"))).ok).toBe(true);
    expect([...rows.keys()].sort()).toEqual(["action:user_a", "other:user_a", "other:user_b"]);
    await expect(limiter.check("missing", "user_a")).rejects.toThrow(/Unknown rate limit/);
  });

  it("old counts are removed now and then (about one request in PRUNE_EVERY), keeping recent ones", async () => {
    let roll = 0.99;
    const { limiter, rows, clock } = setup(() => roll);
    await limiter.check("action", "user_old");
    clock.now = new Date(clock.now.getTime() + RATE_LIMIT_KEEP_MS + 1000);
    await limiter.check("action", "user_new");
    expect(rows.has("action:user_old")).toBe(true);
    roll = 0.5 / PRUNE_EVERY;
    await limiter.check("action", "user_new");
    expect([...rows.keys()]).toEqual(["action:user_new"]);
  });

  it("account deletion's key pattern escapes the id's own wildcards", () => {
    expect(userKeyPattern("user_a1")).toBe(String.raw`%:user\_a1`);
    expect(userKeyPattern("x%\\")).toBe("%:x\\%\\\\");
  });
});
