import type { RateLimitRepo } from "../../db/rate-limits";
import { rateLimited } from "./errors";

// Rate limits (/docs/features/rate-limits.md). Each limited member action allows a number of requests per
// window per member; past it the action answers "too many requests" (429) until the window ends. Use one
// on every member action that costs money, calls a vendor, or could be guessed at (codes, ids).
//
// A server action names its limit: act(schema, raw, op, { limit: "export" }) (lib/actions.ts).

export type Limit = { max: number; windowSeconds: number };

/** The limits by name. Add-ons add theirs after the marker; an application adds its own. Generous for a person, tight for a script. */
export const LIMITS: Record<string, Limit> = {
  // addons: rate limits
};

/** Counts older than this are removed: longer than any window. */
export const RATE_LIMIT_KEEP_MS = 24 * 60 * 60 * 1000;
/** About one request in this many also removes old counts, so no scheduled job is needed. */
export const PRUNE_EVERY = 200;

export function createRateLimiter(deps: { repo: Pick<RateLimitRepo, "hit" | "deleteBefore">; now: () => Date; random?: () => number; limits?: Record<string, Limit> }) {
  const limits = deps.limits ?? LIMITS;
  const random = deps.random ?? Math.random;
  const prune = async () => ({ deleted: await deps.repo.deleteBefore(new Date(deps.now().getTime() - RATE_LIMIT_KEEP_MS)) });
  return {
    /** Counts this request; throws `rate_limited` once the member is past the limit. An unknown name is a programming error. */
    async check(name: string, userId: string): Promise<void> {
      const limit = limits[name];
      if (!limit) throw new Error(`Unknown rate limit: ${name}`);
      const count = await deps.repo.hit(`${name}:${userId}`, limit.windowSeconds, deps.now());
      if (random() < 1 / PRUNE_EVERY) await prune();
      if (count > limit.max) throw rateLimited();
    },
    /** Removes counts nobody needs any more. */
    prune,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
