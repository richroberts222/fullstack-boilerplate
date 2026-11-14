# Lessons Learned

The rule: **every problem that is found becomes a guard or a written rule, in the same pull request that fixes it.** A guard (a test or check that fails) is preferred over prose. A problem that occurs a second time is a process failure: the first guard was missing or too weak, so strengthen it and record the repeat here.

## How to use this log

1. **Fix** the problem.
2. **Close the gap.** Add a test or check that would have caught it (and prove it by breaking the thing on purpose), or add the rule to the document that owns the topic. Name the guard or rule in the table below.
3. **Record** it here: what happened, the root cause, what now prevents it. One line each.
4. **Repeat offenders.** If the same cause appears again, mark the earlier row "repeated", find why the guard missed it, and widen the guard.
5. The pull request template asks: "Did this reveal a gap? Guard or rule added, or why not."

Nothing secret goes in this log (`/CLAUDE.md` section 18).

## How problems are found and closed (the feedback loop)

A problem can arrive from several places. Whatever the source, it ends the same way: fixed, with a guard or a rule, and logged here.

| Source | How it is noticed | How it is closed |
| --- | --- | --- |
| A pull request check fails (lint, tests, build) | CI turns red | Fix the cause; if the check missed the underlying risk, widen the check |
| The weekly health run or the monthly tool risk review | Their summary and issue | Open an issue; fix or record the exception |
| An independent review or the owner | A finding or a question | Verify against the code, then fix |
| A user or tester reports a bug | The bug report form | Fix with a regression test |
| A production error (once error tracking exists; open item) | An alert or a weekly errors-by-workflow review | The error becomes a bug issue using the same form, and the fix needs a regression test like any other fix |

**Mechanical enforcement.** A pull request that is a fix (its title or branch starts with fix, bug or hotfix) fails the CI check `Fix has a guard` unless it adds or changes a test, or adds a lesson to this file explaining why no guard is possible. Dependency-only version bumps are exempt. This makes "fix it and make sure it cannot happen again" part of the pipeline instead of a habit. The check is informational until it has been green for a week, and can then be made a required check in the repository ruleset (an owner setting).

**Detecting breaks in logs.** Today the detectors are CI, the weekly health run and reviews. When error tracking and structured logs exist (`/docs/ideas/observability.md`), a recurring error pattern is opened automatically as a bug issue, and the fix pull request must carry the regression test.

## Rules inherited from the reference project

This application started from a foundation that had already learned these the hard way. They are rules, not history: each is already enforced by the guard or document named, or is a working rule for whoever is doing the work.

| Rule | Where it lives |
| --- | --- |
| Read a document in full, not by its headings; escaped Markdown and invisible control characters are caught by a test | `lib/text-hygiene.test.ts`, `/docs/code-quality.md` |
| A test must be shown failing when the behavior it protects is broken; a test that fails for a different reason protects nothing | `/docs/automation/test-value-review.md` |
| Every scanner gets a self-test with the shapes it must reject, and a guard is scoped to the rule as written, not to the example that prompted it | Working rule |
| A guard that reads the whole repository must not time out as the repository grows; the web test timeout is 30 seconds and a test fails if it is lowered or removed | `apps/web/vitest.config.mts`, `lib/test-config.test.ts` |
| Commit and push only after validation exits with code 0; never chain a commit after validation with `;`. Read the command's own result: a background-task notice is not the result, and a filtered log can hide a crash | `/CLAUDE.md` rule 5 |
| Report what actually ran, never what was intended ("local checks passing" only when all of them ran) | `/CLAUDE.md` rule 5, `/docs/issues.md` |
| Keep shell commands short: one purpose each, code in files, a rejected command is split and not retried unchanged | `/CLAUDE.md` rule 14 |
| Two failures of the same step, then stop and report instead of re-running | `/CLAUDE.md` rule 15 |
| Pace GitHub requests; stop and wait on a rate-limit reply | `/docs/git-workflow.md` section 24 |
| Before saying something does not exist, search the whole repository by name and read the composition root | Working rule |
| Dependency updates must stay compatible with the Expo SDK, and the web and phone apps must agree on shared versions | `scripts/dependency-match.mjs`, `/docs/stack.md` |
| For an optional component prop, pass `undefined` for "nothing", not `null`; a type error after an update is fixed in our code, never by weakening the types | Working rule |
| Never build an edit (partial) schema from a schema that has field defaults: an edit that sends one field would reset the others | Working rule |
| A control repeated per tab or view carries the view in its test id, so a selector never matches two elements | Working rule |
| A screen is not done until a browser test drives it as the real role (for example an admin), including that a refused change keeps what was typed | `/docs/qa-strategy.md` |
| Browser tests in CI serve a production build, not the dev server, which compiles every page on first visit and can exhaust the runner | `playwright.config.ts`, `/docs/automation/playwright.md` |
| A red browser-test log is read from the end first; "The operation was canceled" with no failed test means re-run the failed job only, once | Working rule (`/docs/automation/playwright.md` describes how a killed run looks) |
| After a stopped test run, delete the generated `apps/web/.next/dev` folder before running the type check again | `/docs/automation/playwright.md` |

## Log

| Date | What happened | Root cause | Now prevented by |
| --- | --- | --- | --- |
| 2026-11-13 | Applications were being made by copying another application's first commit and renaming it by hand, because the template repository was weaker than the reference application and had no working way to create an app | The template had fallen behind: the reference application kept improving while the template was a one-time export | This repository is now the authoritative template (owner decision): `pnpm init:app`, the leak detector (which now also refuses the names of every reference application), `pnpm test:boilerplate` inside `pnpm validate`, and the Template proof CI job that builds a generated app on every push (`/docs/boilerplate.md`) |
| 2026-11-13 | The new-app script left the Template proof CI job in a generated application during its own self-test | Its pattern expected Unix line endings, and the file had Windows line endings on this machine | The pattern accepts both; `scripts/boilerplate/boilerplate.test.mjs` asserts the job is gone after init |
| 2026-11-04 | The application was started from the reference project's boilerplate export, which still carried that project's product code, its Expo owner and project id, its icon art, its theme, its merge authorization and its operating history | The export strips the proof slice but not the reference application's own features (a known gap recorded in the reference project's template notes); the leak check looks only for the product's name | Removed by hand in the initial setup. Rule: before the first commit of an application made from the template, search it for the reference project's names, accounts, project ids, owners, dates and decisions, not only its product name |
