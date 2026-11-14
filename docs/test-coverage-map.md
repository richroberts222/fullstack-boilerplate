# Test coverage map

**What this is.** An honest list of what the tests prove and what they do not, screen by screen. It exists because "the tests pass" can hide a screen nobody ever clicked (`/docs/qa-strategy.md` section 3, "automation ships with the feature"). Update it in the same commit as each feature.

## The layers, and what each can and cannot prove

| Layer | Proves | Does not prove |
| --- | --- | --- |
| Unit and service tests | The rules and the wording | That a screen calls the rules correctly |
| API acceptance tests (`lib/api/*.acceptance.test.ts`) | Every route does what the spec says, for the right and wrong person, at the HTTP boundary, with a faked identity | That the screen shows it, or that real sign-in works |
| Real-database integration tests (`db/*.integration.test.ts`) | The real SQL does what the in-memory copy does | The screen |
| Browser tests (`apps/web/e2e`) | A person can do it: real sign-in, real screen, real database | Phones |
| Phone tests (`apps/mobile`) | The phone app's logic | Any screen, on any device |

## The gap measure and its guard

Every control on a screen has a test id (`components/ui/test-ids.test.ts`). `node scripts/audit-test-coverage.mjs` lists the ids that no test file mentions. That does **not** mean the behavior is untested (the rule behind it may be well proven below the screen); it means no test drives that control.

`apps/web/lib/test-coverage.test.ts` fails when a new control ships without a test that mentions its id, and when an id listed in `docs/test-coverage-baseline.json` has been covered (or removed) but is still listed. **The list can only shrink.**

## Screens

| Screen | Rules proven below the screen | Driven in a browser | Gap |
| --- | --- | --- | --- |
| Home, error and not-found pages (starting pages) | n/a | No | All their controls are in the baseline until the first feature replaces them |
| Mobile sign-in (shell) | Environment validation only | No | All its controls are in the baseline; driving phone screens needs a tooling decision (owner's call) |

Add a row per feature screen.

## What this audit cannot see

* Tests that exist but are weak. `/docs/automation/test-value-review.md` is the standard: a test counts only if breaking the behavior makes it fail.
* Phones: no phone screen tests until a tooling decision.
* Real money, real email and other paid services that run in test mode or are off.
