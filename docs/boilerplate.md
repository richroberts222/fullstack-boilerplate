# Boilerplate: Creating a New Application

Template-only document: `pnpm init:app` deletes it from the new application. The ordered human steps for the new application (Clerk, Neon, Vercel, Expo/EAS) live in `/docs/new-app-setup.md`, every identity and naming location in `/docs/customization-map.md`, and how the stack fits together in `/docs/stack.md`; the new application keeps all three.

**This repository is the authoritative template** (owner decision, 2026-11-13). New applications are made from it directly; no application is the template's source any more. Improve the foundation here, and carry an improvement found in an application back here.

Its base is domain-free: no product features, no domain tables, no migrations. Reviewed, reusable pieces that some applications need (for example payments) are optional **add-ons** (owner decision, 2026-11-18): a new application takes one only when it asks for it with `--with`, so an application without them stays domain-free. It carries a neutral placeholder identity ("App Boilerplate", `app-boilerplate`, `com.example.appboilerplate`) that `init:app` replaces everywhere.

## Create a new application

1. Make a new repository from this one (GitHub "Use this template", or a fresh copy with the history removed). Run init **once, in that fresh copy**.
2. Run:

```text
pnpm init:app --name="Harbor Notes" --slug=harbor-notes --bundle-id=com.harbornotes.app [--scope=harbor-notes] [--with=<add-on>,...|all] [--dry-run]
```

| Flag | Becomes |
| --- | --- |
| `--name` | display name: web title, header and home page, mobile `name`, docs prose |
| `--slug` | root package name, Expo `slug` and URL `scheme`, tooling ledger schema prefix, repository name in the docs |
| `--scope` (default: slug) | npm scope for `packages/*` |
| `--bundle-id` | `ios.bundleIdentifier` and `android.package`; required; `com.example.*`, the template identity and reference-application names are rejected |
| `--with` | optional add-ons to include (section "Add-ons"); `all` takes every one; default none |
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
scripts/boilerplate/addons.mjs            the add-on mechanism used by init (section "Add-ons")
```

`pnpm prove:init --full` initializes a fictional application, with every add-on, in a temp directory, then installs, lints, typechecks, tests, builds, and generates a first migration offline. It needs network only for `pnpm install` and creates no external resources. CI runs it on every push and pull request as the **Template proof** job.

### Leak detector

`pnpm check:boilerplate [--dir=<path>]` (exit 1 on findings) reports: the template identity, the name of any reference application (`REFERENCE_APP_NAMES`: the applications this foundation came from or was used for), template-only files, `com.example.*` store ids in `app.config.ts`, and credential-shaped content. On this template it correctly reports the template identity and nothing else; on an initialized application it must be clean.

### Doc markers

`<!-- boilerplate:template:start -->...<!-- boilerplate:template:end -->` wraps prose that only makes sense in the template; init removes it. Markers on their own lines remove a whole section; inline markers remove exactly the enclosed text. In YAML, `# boilerplate:template:start` and `# boilerplate:template:end` comments do the same for the CI job.

## What is included

Monorepo (pnpm workspaces); `apps/web` (Next.js App Router, Tailwind v4, shadcn/ui, Clerk, versioned API adapter, service layer, data-access layer, Drizzle, migration/reset/seed tooling, Vitest unit and integration configs, Playwright config); `packages/shared`; `packages/validation`; `apps/mobile` (Expo shell, env validation, `eas.json`); CI, Claude, health, monthly-review and production-migration workflows; `CLAUDE.md` and every rule under `docs/`, with their guards.

## Not included (on purpose)

Product domain code in the base, example features, any migration or domain table in the base, real credentials, and any external resource.

## Add-ons

An add-on is a folder `addons/<name>/` (template-only: init removes the folder after copying what was chosen):

```text
addons/<name>/addon.json   { "name", "description", "requires": [other add-ons], "inserts": [{ "file", "marker", "text" }] }
addons/<name>/files/...    copied to the same path in the new application
```

Rules, enforced by `scripts/boilerplate/addons.mjs` and its tests (`boilerplate.test.mjs`, "add-ons"):

* An add-on only **adds** files. It changes a base file only through an insert: `text` goes on the lines after a `marker` line that the base file carries on purpose and that appears exactly once. Every check runs before anything is written.
* `requires` names add-ons that must be chosen too; init orders them so each comes after what it needs.
* Add-on files get the new application's identity like every other file, and must pass the leak check: generic names only, never a reference application's.
* An add-on brings its own spec in `docs/features/`, its tables in their own schema file, its tests, and its rows in `docs/data-inventory.md`; it stays off until the application's settings or environment turn it on.
* `pnpm prove:init --full` (the Template proof CI job) builds an application with every add-on, so each one is installed, linted, typechecked, tested and built on every push.

### Adding an add-on to an application that already exists

```text
node scripts/boilerplate/apply-addon.mjs --dir=<the application> --with=<add-on>[,<add-on>] [--dry-run] [--name="App Name"]
pnpm addon:apply --dir=<the application> --with=<add-on>      (same thing, run from a copy of this template)
```

Run it from a copy of this template; it reads the add-ons from there (an application has no `addons/` folder) and gives their text the application's own identity, read from its package files. It checks everything first and then writes: if any file would be overwritten, a target file is missing, or a marker line is missing or repeated, it lists every one of them and changes nothing. An add-on already there (all its files exist) is refused; an add-on that needs another is allowed when the other is already in the application, otherwise name it in `--with`. Afterwards: `pnpm --filter web db:generate` for the new tables, then `pnpm validate`. An application made before a marker line existed needs that line added by hand first (the message says which). `pnpm prove:init --full --apply` proves it: an application made with no add-ons, then given `legal` and `payments`, installed, linted, typechecked, tested and built.

Available add-ons: `rate-limits`, `legal` (terms and privacy pages, acceptance, data export, account deletion), `audit` (owner settings and the audit trail) and `payments` (in progress: its tables, contracts and data export and deletion are in; services, checkout, Stripe and billing follow, task list in the source application). `payments` needs `legal` and `audit`.

## Maintaining this template

* Keep it domain-free: add no feature code here. Improve the foundation, run `pnpm validate` (it includes `pnpm test:boilerplate`), and let the Template proof job confirm a generated application still passes.
* Every guard test must pass in a generated application too, not only here (`/docs/lessons.md`): never hard-code the template identity in a guard.
* When an application finds a defect in the foundation, fix it here as well and log it in `/docs/lessons.md`, so the next application starts with the fix.
* Initialization uses textual substitution of the template identity; do not introduce other spellings of the placeholder name.
* Add a new reference application's name to `REFERENCE_APP_NAMES` when foundation code is copied from it.

## Known limitations

No Clerk-authenticated mobile call yet (the shell has no Clerk SDK); no CI job for integration or browser tests (they need secrets); Stage hosting is an open decision; production migrations are a documented human procedure; only Metro bundling of the mobile app is verified, not a device run or an EAS build.
