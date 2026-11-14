# CLAUDE.md

Guidance for Claude Code in the App Boilerplate repository. This file is the entry point: the rules that always apply, and a map of where the detail lives. When you need a rule's detail, follow the link; do not rely on memory.

---

# Operating rules (read first)

1. **Documentation is the source of truth.** Read the relevant `/docs` file before significant work (§3). A missing or empty document means no rules yet, never invented rules. Undecided stays undecided; ask Rich (§17).
2. **One platform, many clients.** The server is authoritative; clients never touch the database; replaceable boundaries get an interface (port); dependencies point inward (§4, §6, §7, `/docs/code-quality.md` §12).
3. **Rich gives specs; Claude builds the entire app.** The files in `/docs/specs/` authorize building everything they describe; no per-feature approval or issue is needed. Claude writes the buildable specs in `/docs/features/` (numbered acceptance criteria, controls, scope fence), builds slice after slice with their automated tests in the same commit, and moves to the next slice without asking. Anything beyond the specs is a recommendation to Rich, not work to start. Stop only for rules 8, 9 and 10, for what only Rich can do, or for a question the specs truly do not answer and that rule 17 cannot turn into a setting (`/docs/qa-strategy.md` §3).
4. **Tests must be meaningful.** Every new test must be shown failing when the behavior it protects is broken (`/docs/automation/test-value-review.md`). Never weaken, skip or disable a test, guard or validation to make a failure pass (§12).
5. **Prove before claiming.** Run `pnpm validate`; commit and push only after it exits cleanly; report exact commands and results; never claim CI passed unless it ran.
6. **Secure by default.** No secrets in committed files (§18); meet `/docs/secure-coding.md` (hostile input, data tiers: never store Social Security numbers, card numbers or medical records, no raw HTML).
7. **Git:** Claude commits and pushes directly to `main` (Rich, 2026-11-04). Branches and pull requests are optional: use them when Rich asks or to try something risky. The guards stay: `pnpm validate` must exit cleanly before every push (rule 5); never force-push, rewrite `main`'s history or delete `main`; after each push check the `Validate` run, and if it is red, fixing it is the next job (§10, §19; `/docs/git-workflow.md`).
8. **Ask before spending** on any vendor, account, plan, domain or tool.
9. **Database:** change schema only through the documented migration process; never touch `prod` (§13).
10. **Legal gates:** no real user data is collected until the gates in `/docs/risk-and-legal.md` are met. That document is a checklist, not legal advice.
11. **Workflow files, repository settings and security configuration** change only when Rich asks, or by the owner. Never weaken one to get work through.
12. **Every problem becomes a rule.** When a defect or mistake is found, add a guard (preferred) or a rule in the owning document in the same commit, and log it in `/docs/lessons.md`. A repeat is a process failure: widen the guard. A fix must add or change a test, or log a lesson (CI enforces this only on pull requests, so on a direct push it is Claude's job).
13. **Surface conflicts.** If instructions, documents and the repository disagree, say what was assumed, what exists and why it matters; stop and ask if the difference is material.
14. **Keep shell commands short.** One purpose per command; never a long chain, a large inline heredoc or a multi-line inline script. Put multi-line code in a file with the file-writing tool and run that file. If a command is rejected as malformed, split it; do not retry it unchanged (`/docs/lessons.md`).
15. **Two failures, then stop.** If the same step fails twice, stop: do not try a third time unchanged and do not keep spinning. Say what is failing, what is known about the cause, and what the real fix would cost, then ask Rich (owner rule, 2026-10-11; `/docs/lessons.md`).
16. **Requirements are the authority.** For a product or content question, read `/docs/specs/`, `/docs/product/product-plan.md` and the approved specs in `/docs/features/` first and answer from them, citing the section. Ask Rich only when they truly do not say, and say what was checked.
17. **Make open product decisions configurable.** When a product question is undecided (limits, prices, who gets what), do not ask for a yes or no and do not hard-code an answer: spec it as an audited admin-console setting with a safe default. Still ask for what only Rich can do (spending, legal, secrets) and for naming or branding that is truly undecided.
18. **No mobile store builds on Claude's own initiative.** Never start an EAS or store build unless Rich says so; builds are limited. Record phone-only changes in `/docs/to-do.md` for the next build. Running the Expo dev server is fine.
19. **Never hand Rich a task Claude can do.** Before asking Rich to click, copy, paste or configure anything, check whether Claude can do it with the tools it has (the Vercel, GitHub and database command-line tools, the file tools, the APIs). Do it, and report the result. Ask Rich only for what no tool can do: signing in to an account that has no logged-in tool, spending money (rule 8), legal decisions, and secrets that only his account can show. Then give exactly one step at a time (Rich, 2026-11-14).
20. **"Proceed" means the next task in `/docs/notes.md`** (create it if missing). Read that file, take the first open package for your model (Opus, Sonnet or Haiku; your model name is in your system prompt; Fable counts as Opus), do only that package, and record the result there in the same commit, so that Rich can clear the conversation after every task and lose nothing. Never keep state only in chat. One session per folder at a time. Every reply that finishes or stops work ends with one closing line: `Safe to clear. Next: /model <Opus|Sonnet|Haiku>, then proceed.`, naming the model of the next open package in `/docs/notes.md` (or "nothing open"); if state is not yet saved, `Not safe to clear:` and why (Rich, 2026-11-14).
21. **Spend tokens on the work, not on words.** Answer first, in a few lines; say a thing once; lists of at most 7 short lines; read only the files the task names; keep long command output in a file, not in the conversation. Errors, failed checks and risks are still stated in full (Rich, 2026-11-14).

---

# 1. Project Overview

App Boilerplate is **one platform with multiple clients**: a web application, an Android application, an iPhone application, a shared backend/API, shared authentication, and a shared data layer. It is not three independent applications. The user-facing product name is **App Boilerplate** (`/docs/naming-conventions.md`).

---

# 2. Architectural Authority

`/docs/architecture-rules.md` is the primary architectural authority and takes precedence over assumptions about how a framework or feature should be implemented. Before an architectural change, read the relevant documentation in `/docs`.

---

# 3. Documentation-First Development

Before generating or significantly modifying code, check the relevant documentation. Not every listed document exists in every copy of the repository.

| Area | Documents |
| --- | --- |
| Architecture and code | `architecture-rules.md` (authority), `code-quality.md`, `services.md`, `shared-code.md`, `stack.md` |
| Web and mobile | `web.md`, `mobile.md`, `ui.md`, `routing.md`, `server-components.md` |
| Data | `database.md`, `data-inventory.md`, `data-fetching.md`, `data-mutations.md` |
| API and integrations | `api.md`, `integrations.md`, `payments.md` |
| Identity and security | `auth.md`, `permissions.md`, `security.md`, `secure-coding.md`, `environment.md` |
| Quality | `testing.md`, `qa-strategy.md`, `unit.md`, `integration.md`, `acceptance.md`, `e2e.md`, `playwright.md`, `coverage.md`, `reporting.md`, `test-value-review.md` (all in `automation/`), `test-coverage-map.md` (what the tests drive and the known gaps) |
| Delivery | `git-workflow.md`, `issues.md` (required for any issue or pull request), `deployment.md`, `release.md`, `to-do.md` (the owner's current open actions; Claude removes items when done), `exploratory-testing.md` (the owner's guide for exploratory testing and how to report findings) |
| Product | `product-development.md`, `naming-conventions.md`, `product/product-plan.md`, `specs/` (Rich's source specs and requirements, as written), `features/` (approved, buildable specs derived from them) |
| Risk, growth and learning | `risk-and-legal.md`, `incident-response.md`, `future-readiness.md`, `lessons.md` |
| Template | `new-app-setup.md`, `customization-map.md`<!-- boilerplate:template:start -->, `boilerplate.md` (this repository is the authoritative template; how to make a new application from it)<!-- boilerplate:template:end --> |

(All paths are under `/docs`.) A test fails if a document in `/docs` is not linked from this table.

**Empty or missing documents.** An empty file means the project has not established rules for that area; it must not be read as containing rules. If a document is missing, do not invent its contents. If a missing or empty document is needed for an architectural decision and the decision cannot safely be made from existing documents, ask for clarification.

---

# 4. Architecture Compatibility

When adding, replacing or significantly changing an architectural component, consider Web, Android, iPhone, API, authentication, database, shared code, business logic, testing, deployment and environment configuration. Use `/docs/architecture-rules.md` for the compatibility check. Do not optimize one client at the expense of the platform. If a proposal creates a conflict, stop and explain it first.

---

# 5. Technology Architecture

Defaults, not permission to introduce incompatible patterns: Next.js (App Router), React and TypeScript with Tailwind and shadcn/ui on Vercel; React Native and Expo for Android and iPhone; Clerk for authentication; Next.js server code and API routes as the backend; PostgreSQL on Neon with Drizzle ORM; Git, GitHub and pull requests; Claude Code as the development agent. How they fit together: `/docs/stack.md`. Before replacing a technology or adding a major framework or service, consult `/docs/architecture-rules.md`.

---

# 6. Backend Boundary

Web, Android and iPhone are clients of the App Boilerplate backend and must never access the database directly. Authentication is validated at the server boundary; secrets and privileged database access stay server-side.

```text
Web --------\
Android ------> App Boilerplate API ---> Drizzle ---> Neon
iPhone -------/
```

---

# 7. Shared Architecture

Share API contracts, TypeScript types, validation schemas, data models, constants and authoritative business rules where appropriate. Do not duplicate server-authoritative logic across clients, and never expose server-only code or secrets to clients (`/docs/shared-code.md`).

---

# 8. Web and Mobile Independence

Web and mobile may differ in UI, navigation, layout, interaction and platform behavior. Do not force web UI architecture onto mobile, and do not create separate backend or data architectures because the interfaces differ.

---

# 9. Documentation as Source of Truth

When implementation and documentation disagree: identify the discrepancy, decide which is outdated, do not silently establish a new pattern, and update the documentation when an architectural decision changes. Material documentation drift is a defect; update documents in the same work.

---

# 10. Git Workflow

Read the specs and documents, inspect the implementation, build, validate, commit, push to `main`, check the `Validate` run, and report results. Detail: `/docs/git-workflow.md`. Branches, issues and pull requests are optional (`/docs/issues.md` applies when one is used). Pace GitHub requests gently and stop on a rate-limit reply (`/docs/git-workflow.md` §24).

---

# 11. Vercel

Vercel hosts the web application. Pull requests use Vercel Previews where available. A successful deployment does not by itself prove architectural compatibility.

---

# 12. Testing

Testing protects the whole platform. The strategy, the per-feature definition of done and the layers are in `/docs/qa-strategy.md`; commands and status in `/docs/testing.md`. Never weaken a test or guard to pass; fix the cause.

---

# 13. Database Safety

Database changes follow the documented migration process in `/docs/database.md`. Keep a reliable way to apply migrations, seed development and test data, reset test data and reproduce known states. Never destroy migrations or required configuration when resetting data, and never target `prod` from local tooling or tests.

---

# 14. Simplicity

Prefer the simplest implementation that satisfies the requirements and preserves the architecture. Do not add frameworks, services, dependencies, databases, authentication systems, build systems or abstraction layers without a documented reason. Keep dependencies and tooling compatible with each other (versions, peers, the Expo SDK); upgrade deliberately, not automatically (`/docs/stack.md`).

---

# 15. Architectural Changes

A feature request does not authorize an architectural change. If implementation needs an undocumented significant architectural decision, identify it, check the affected components and clients, document the decision when appropriate, and ask rather than silently choosing.

---

# 16. Priority Order

1. Existing documented architecture. 2. Existing project conventions. 3. Compatibility across all clients. 4. Security and data integrity. 5. Maintainability. 6. Simplicity. 7. Feature-specific convenience. A convenient implementation that violates the architecture is not acceptable.

---

# 17. Do Not Assume Undocumented Rules

Distinguish established rules, technology defaults, existing patterns, suggestions and undecided questions. Do not turn a suggestion into a rule without recording it in the proper document. Treat anything undecided as undecided.

---

# 18. Secrets in Committed Files

Never put real database URLs, credential-shaped URLs (any `scheme://user:password@host/...`, even fake), API keys, tokens, passwords or private keys into documentation, examples, comments, test descriptions or any committed file. Use obvious placeholders (`<DEV_DATABASE_URL>`, `<API_KEY>`, `<TOKEN>`) and describe a value instead of reproducing it. The security tests enforce this; never change them to make a failure pass; remove the offending content.

---

# 19. Product Development System

Detail: `/docs/product-development.md`.

* Naming: `/docs/naming-conventions.md` is authoritative; do not invent terms marked UNDECIDED; ask Rich. Do not rename technical identifiers without a compatibility evaluation.
* Direction: `/docs/specs/` (Rich's source material) is the authority, summarized in `/docs/product/product-plan.md`; specs in `/docs/features/` define exact behavior. The specs authorize building what they describe (rule 3); an idea outside them does not.
* When a branch or pull request is used, one issue is one canonical branch and one pull request (`/docs/issues.md`).
* Repository facts outrank external assumptions. Rich reviews UI on the running app; a change Rich rejects is fixed forward in a new commit.
* **Merging:** the normal path has nothing to merge, because Claude pushes to `main` (rule 7). If a pull request is used, Claude may merge it once `Validate` passes. A failing check always blocks a push or a merge.
* Git history and the GitHub checks are the live source of truth. `docs/notes.md` is optional and holds only non-discoverable information.

---

# 20. Code Quality, Reuse, and Refactoring

`/docs/code-quality.md` is authoritative (Clean Code, SOLID, Clean Architecture; ports at replaceable boundaries) and `/docs/ui.md` for UI. Reuse existing behavior, components, tokens and contracts before creating duplicates, but do not abstract coincidental similarity. Broad or repository-wide refactors need explicit authorization (a separate approved issue). Audit findings are reported, not silently fixed.

---

# 21. Final Rule

Before implementing anything substantial, ask: **"Does this work as part of the App Boilerplate platform, or does it only work for the feature or client I am currently looking at?"** App Boilerplate must stay coherent across Web, Android, iPhone, the API, Clerk, Neon, Drizzle and Vercel. When in doubt, consult `/docs/architecture-rules.md` and the relevant document before proceeding.
