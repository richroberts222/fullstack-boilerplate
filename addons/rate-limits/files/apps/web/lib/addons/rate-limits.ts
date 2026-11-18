import "server-only";

import { getDb } from "../../db";
import { createRateLimitRepo } from "../../db/rate-limits";
import { createRateLimiter, type RateLimiter } from "../services/rate-limit";

// Rate-limits add-on wiring (/docs/features/rate-limits.md), kept apart from lib/composition.ts so the
// add-on never edits the base composition root. Lazy, like every getter there.

let limiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  return (limiter ??= createRateLimiter({ repo: createRateLimitRepo(getDb()), now: () => new Date() }));
}
