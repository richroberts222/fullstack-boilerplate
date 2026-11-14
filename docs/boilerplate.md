# Boilerplate: Creating a New Application

Template-only document: `pnpm init:app` deletes it from the new application. The ordered human steps for the new application (Clerk, Neon, Vercel, Expo/EAS) live in `/docs/new-app-setup.md`, every identity and naming location in `/docs/customization-map.md`, and how the stack fits together in `/docs/stack.md`; the new application keeps all three.

**This repository is the authoritative template** (owner decision, 2026-11-13). New applications are made from it directly; no application is the template's source any more. Improve the foundation here, and carry an improvement found in an application back here.

It is domain-free: no product features, no domain tables, no migrations. It carries a neutral placeholder identity ("App Boilerplate", `app-boilerplate`, `com.example.appboilerplate`) that `init:app` replaces everywhere.

## Create a new application

1. Make a new repository from this one (GitHub "Use this template", or a fresh copy with the history removed). Run init **once, in that fresh copy**.
2. Run:

```text
pnpm init:app --name="Harbor Notes" --slug=harbor-notes --bundle-id=com.harbornotes.app [--scope=harbor-notes] [--dry-run]
```

| Flag | Becomes |
| --- | --- |
| `--name` | display name: web title, header and home page, mobile `name`, docs prose |
| `--slug` | root package name, Expo `slug` and URL `scheme`, tooling ledger schema prefix, repository name in the docs |
| `--scope` (default: slug) | npm scope for `packages/*` |
| `--bundle-id` | `ios.bundleIdentifier` and `android.package`; required; `com.example.*`, the template identity and reference-application names are rejected |
| `--dry-run` | prints every change without touching files |

3. Init replaces the template identity in every text file (including `pnpm-lock.yaml`, so `--frozen-lockfile` keeps working), removes template-only prose and the Template proof CI job, resets `docs/notes.md`, deletes template-only files, and finishes by running the leak check.
4. `corepack enable && pnpm install`, `pnpm validate`, then follow `/docs/new-app-setup.md`.

Not automated, deliberately: creating Clerk, Neon, Vercel, GitHub, Expo/EAS, Apple or Google resources; filling credentials; renaming the GitHub repository.

## Mechanism

```text
scripts/boilerplate/manifest.mjs          inventory: PROOF_PATHS (empty), TEMPLATE_ONLY_PATHS, REFERENCE_APP_NAMES
scripts/boilerplate/init-app.mjs          pnpm init:app          (one-shot, no dependencies, no network)
scripts/boilerplate/check-boilerplate.mjs pnpm check:boilerplate (read-only leak detector)
scripts/boilerplate/boilerplate.test.mjs  pnpm test:boilerplate  (runs init in a temp copy; part of pnpm validate)
scripts/boilerplate/prove-init.mjs        pnpm prove:init [--full] [--keep]
```

`pnpm prove:init --full` initializes a fictional application in a temp directory, then installs, lints, typechecks, tests, builds, and generates a first migration offline. It needs network only for `pnpm install` and creates no external resources. CI runs it on every push and pull request as the **Template proof** job.

### Leak detector

`pnpm check:boilerplate [--dir=<path>]` (exit 1 on findings) reports: the template identity, the name of any reference application (`REFERENCE_APP_NAMES`: the applications this foundation came from or was used for), template-only files, `com.example.*` store ids in `app.config.ts`, and credential-shaped content. On this template it correctly reports the template identity and nothing else; on an initialized application it must be clean.

### Doc markers

`<!-- boilerplate:template:start -->...<!-- boilerplate:template:end -->` wraps prose that only makes sense in the template; init removes it. Markers on their own lines remove a whole section; inline markers remove exactly the enclosed text. In YAML, `# boilerplate:template:start` and `# boilerplate:template:end` comments do the same for the CI job.

## What is included

Monorepo (pnpm workspaces); `apps/web` (Next.js App Router, Tailwind v4, shadcn/ui, Clerk, versioned API adapter, service layer, data-access layer, Drizzle, migration/reset/seed tooling, Vitest unit and integration configs, Playwright config); `packages/shared`; `packages/validation`; `apps/mobile` (Expo shell, env validation, `eas.json`); CI, Claude, health, monthly-review and production-migration workflows; `CLAUDE.md` and every rule under `docs/`, with their guards.

## Not included (on purpose)

Product domain code, example features, any migration or domain table, real credentials, and any external resource.

## Maintaining this template

* Keep it domain-free: add no feature code here. Improve the foundation, run `pnpm validate` (it includes `pnpm test:boilerplate`), and let the Template proof job confirm a generated application still passes.
* Every guard test must pass in a generated application too, not only here (`/docs/lessons.md`): never hard-code the template identity in a guard.
* When an application finds a defect in the foundation, fix it here as well and log it in `/docs/lessons.md`, so the next application starts with the fix.
* Initialization uses textual substitution of the template identity; do not introduce other spellings of the placeholder name.
* Add a new reference application's name to `REFERENCE_APP_NAMES` when foundation code is copied from it.

## Known limitations

No Clerk-authenticated mobile call yet (the shell has no Clerk SDK); no CI job for integration or browser tests (they need secrets); Stage hosting is an open decision; production migrations are a documented human procedure; only Metro bundling of the mobile app is verified, not a device run or an EAS build.
