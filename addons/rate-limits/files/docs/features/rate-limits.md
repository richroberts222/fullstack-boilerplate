# Rate limits (add-on)

Installed with `pnpm init:app --with=rate-limits` (or as a requirement of another add-on). Status: reviewed in a production application (2026-11-18), then made generic.

## Need

A signed-in script must not be able to guess codes, flood a payment provider with checkouts, or spam a form. Each limited member action allows a number of requests per window per member.

## Rules

- A server action names its limit: `act(schema, raw, op, { limit: "<name>" })` (`apps/web/lib/actions.ts`). The count runs after sign-in is checked and before the input is read.
- Limits live in `LIMITS` (`apps/web/lib/services/rate-limit.ts`); add-ons add theirs; the application adds its own. An unknown name is a programming error, not a pass.
- One database statement per request (`apps/web/db/rate-limits.ts`): an insert that counts, or starts a new window when the old one has passed, so requests at the same moment on different servers all count.
- Past the limit the action answers `rate_limited` (HTTP 429 through the API adapter) until the window ends.
- Counts older than a day are removed as the limiter runs (about one request in 200), so no scheduled job is needed. Account deletion removes the member's counts (the `legal` add-on does it).

## Acceptance criteria

- **AC1** The limit is allowed; the next request is refused with `rate_limited`; after the window it is allowed again.
- **AC2** Members and limits are counted apart; an unknown limit name throws.
- **AC3** Old counts are removed now and then; recent ones stay.
- **AC4** Account deletion's pattern matches only that member's keys.

## Scope fence

In: per-member limits on server actions. Out: limits for visitors (no identity; use the hosting provider's firewall), limits on the API adapter's routes (add when an endpoint needs one).

## Done checklist

| Item | Proof |
| --- | --- |
| AC1 to AC4 | `apps/web/lib/services/rate-limit.test.ts` |
| The database statement | Checked against a real Postgres database in the application it came from |
| Data | Table `rate_limits` (`apps/web/db/addons/rate-limits.ts`), rows in `/docs/data-inventory.md` |
