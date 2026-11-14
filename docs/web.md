# Web Application

## Location and stack

The Web application lives in `apps/web`.

* Next.js (App Router), React, TypeScript
* Tailwind CSS v4
* shadcn/ui (see `/docs/ui.md`)
* Deployed on Vercel

Clerk is integrated in the Web app (see `/docs/auth.md`). Drizzle ORM and the Neon serverless driver are installed; the server-only connection lives in `apps/web/db` and no product tables are defined yet (see `/docs/database.md`).

Shared packages (`packages/shared`, `packages/validation`) are consumed as TypeScript source and are listed in `transpilePackages` in `next.config.ts`; add any new shared package there at its first import (see `/docs/shared-code.md`).

## Service layer

Business rules live in `apps/web/lib/services/` conventions (typed inputs, `ServiceContext`, `runService()` result mapping, injected data access and atomic runner), not in components, route handlers, or Server Actions. See `/docs/services.md`.

## Agent instructions

Next.js 16's automatic `AGENTS.md`/`CLAUDE.md` generation (`next dev`) is intentionally disabled via `agentRules: false` in `apps/web/next.config.ts`. Those files are not authoritative for this project: the root `CLAUDE.md` and `/docs` are the sole source of project guidance. `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are gitignored as a safety net in case this is ever re-enabled.

## Commands

Run from the repository root:

```text
pnpm dev        # start the web dev server
pnpm lint       # eslint
pnpm typecheck  # next typegen && tsc --noEmit
pnpm build      # next build
```

Database migration commands (Drizzle Kit). They read `DATABASE_ENV` (`dev|qa|stage|prod`) and `DATABASE_URL` from `apps/web/.env.local` (template: `apps/web/.env.example`) and refuse `prod`. Reset and seed commands are in `/docs/database.md` section 12.2. Confirm the target environment before running `db:migrate`.

```text
pnpm --filter web db:generate --name=<slug>      # drizzle-kit generate (SQL migrations to apps/web/drizzle; no database access)
pnpm --filter web db:migrate --env=dev|qa|stage # apply committed migrations (guarded; --env is mandatory; refuses prod)
pnpm --filter web db:migrate:status --env=...   # read-only: applied vs pending
pnpm --filter web db:migrate:verify --env=...   # read-only: nothing pending, no unknown history
```


## Global app shell and navigation

* `components/shell/app-shell.tsx` wraps every page from `app/layout.tsx`. Pages must not render their own global navigation or wordmark.
* `lib/navigation/nav-config.ts` is the single list of global destinations (Home, and Dashboard when signed in). `components/shell/app-header.tsx` is one renderer of that list (header on `sm` and up, disclosure menu below). A different pattern (sidebar, bottom tabs) replaces the renderer, not pages.
* The brand mark is `components/brand/brand-wordmark.tsx`: text until a logo exists. It is shown once, centered above the navigation on every page and linked to `/` by the header; larger on the home page.
* Client/server boundary guard: `components/server-boundary.test.ts` checks every component folder automatically, so a component with event handlers must declare `"use client"`.
