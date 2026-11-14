# Naming Conventions

Authoritative for product-facing, domain, and technical terminology. If a needed term is not resolved here or elsewhere in `/docs`, stop and ask Rich; do not invent terminology.

## 1. Product name

| Use | Value |
| --- | --- |
| Official user-facing name (human-readable) | **App Boilerplate** |
| Slug (where appropriate) | `app-boilerplate` |
| Established repository identifier | `fullstack-boilerplate` (GitHub repository `richroberts222/fullstack-boilerplate`, private) |

## 2. Technical identifiers

Set by `pnpm init:app` and recorded in `/docs/customization-map.md`:

* Root package `app-boilerplate`; shared packages under the `@app-boilerplate/*` scope; workspaces `web`, `mobile`.
* Tooling ledger schema `app_boilerplate_tooling`.
* Mobile bundle identifier and Android package `com.example.appboilerplate`: **a placeholder chosen at setup, not yet registered with Apple or Google.** It is permanent once published to a store, so confirm it before the first store build.
* No database names, or Neon/Clerk/Vercel project names are recorded in the repository.

**These are NOT to be renamed to conform to this document.** Renaming package names, URLs, environment variables, database identifiers, application/bundle IDs, or external-service identifiers requires first evaluating migration and compatibility impact, and an approved issue.

## 3. Domain terminology

Nothing is resolved yet. Every domain term is **UNDECIDED** until the owner resolves it. Do not infer meanings from placeholder or mock data, and do not treat similar terms as interchangeable. Resolving a term here defines vocabulary only; it does not authorize implementation or define a data model.

| Term | Canonical meaning | Status |
| --- | --- | --- |
| (none yet) | | UNDECIDED |

When Rich resolves a term, record its meaning, its relationship to neighboring terms, and (separately) the technical identifier used in code and the database, then remove UNDECIDED.

## 4. Process

* New terms are added here in the same PR that introduces them, after Rich approves them.
* Terminology changes update affected feature specs and documentation (documentation drift rule, `/docs/product-development.md`).
