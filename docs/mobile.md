# Mobile

The mobile app lives in `apps/mobile` (React Native, Expo SDK 57, TypeScript; Android and iPhone). It is a foundation shell only: it starts, compiles, bundles, and loads validated configuration. It has no domain screens, navigation, data models, roles, or API client yet.

## Where mobile fits

```text
Web ------\
           > API / server --> business/service --> data access --> Drizzle --> Neon
Mobile ---/
```

Mobile is a client of the App Boilerplate API, exactly like Web. It never reaches the data-access, Drizzle, or Neon layers. Identity comes from Clerk (shared with Web); the server validates every request.

## Web/mobile separation

* Web and mobile are separate apps with independent UI, navigation, and platform behavior. Do not port Next.js/web UI code (Tailwind, shadcn/ui, Server Components) into mobile.
* They share the backend, authentication provider, contracts, and validation via `packages/*` (`/docs/shared-code.md`).

## What may and may not be shared

| Code | Web | Mobile | Server |
| --- | --- | --- | --- |
| `@app-boilerplate/shared` (pure types, constants, `Result`, env parsing, utilities) | yes | yes | yes |
| `@app-boilerplate/validation` (Zod schemas, API contracts) | yes | yes | yes |
| React components, Tailwind, shadcn/ui, Next.js APIs | web only | never | never |
| React Native / Expo components and APIs | never | mobile only | never |
| `drizzle-orm`, `@neondatabase/serverless`, `db/`, `server-only` modules | never | never | yes |
| `DATABASE_URL`, `CLERK_SECRET_KEY`, any secret | never | never | yes |
| `apps/web/*` imports | n/a | never | n/a |

Mobile consumes workspace packages as TypeScript source through pnpm workspace links (`"@app-boilerplate/shared": "workspace:*"`); Expo SDK 57 configures Metro for monorepos automatically, so no `metro.config.js` is needed. This was verified by bundling both platforms.

`src/boundary.test.ts` statically enforces the boundary: no server/database/Next.js imports, no `apps/web` imports, `process.env` reads limited to `EXPO_PUBLIC_*` literals, and no forbidden packages in `package.json`.

Note: `@app-boilerplate/shared` includes pure server/database env parsers. They are bundled into the app as dead code but contain only variable names, never values, and mobile never calls them.

## Backend boundary

* Mobile talks to the App Boilerplate HTTP API only. It never connects to Neon, never imports `drizzle-orm`, and never imports from `apps/web`.
* The API must expose what mobile needs as documented contracts (defined in `/docs/api.md`; the bearer-token path is accepted by the API but has not yet carried a real token from a mobile client).
* API auth for mobile uses Clerk session tokens sent as bearer tokens and validated on the server (`/docs/auth.md` sections 2 and 5). Mobile does not implement its own identity or authorization; the web/backend auth foundation is not redesigned here.

## Configuration

* `src/config/env.ts` (`getMobileEnv()`) reads `EXPO_PUBLIC_*` variables by explicit literal `process.env` access (Expo inlines only literal reads) and validates them with the shared `parseMobileClientEnv`.
* Variables (all public in the app bundle): `EXPO_PUBLIC_APP_ENV` (required, `dev|qa|stage|prod`), `EXPO_PUBLIC_API_BASE_URL` (required; `http` only allowed for `dev`), `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (optional until the Clerk integration; must be `pk_`, live keys only in `prod`).
* Only client-safe values belong in `EXPO_PUBLIC_*`. Never put `DATABASE_URL`, `CLERK_SECRET_KEY`, or any secret in the Expo config, `eas.json`, or `.env` files shipped with the app.
* Local setup: copy `apps/mobile/.env.example` to `apps/mobile/.env.local` (gitignored).
* The API base URL is per environment (`dev`, `qa`, `stage`, `prod`); no production URL is the default in development builds.
* App name, slug, scheme, and bundle/application identifiers come from a single config (`app.config.ts`) and are set when the application is initialized (`/docs/new-app-setup.md`).

## Commands

Run from the repository root (`pnpm --filter mobile <script>`) or inside `apps/mobile`:

| Script | Purpose |
| --- | --- |
| `start` | Start the Expo dev server (Expo Go / dev client). |
| `android` / `ios` | Start and open on an emulator/simulator (needs the Android SDK / macOS+Xcode). |
| `lint` | ESLint with `eslint-config-expo`. Included in `pnpm lint`. |
| `typecheck` | `tsc --noEmit`. Included in `pnpm typecheck`. |
| `test` / `test:watch` | Vitest for pure TypeScript (config and boundary checks). Included in `pnpm test`. |
| `check:deps` | `expo install --check`: dependency versions match the Expo SDK. |
| `export` | Metro-bundle Android and iOS into `dist/` (compile proof; needs `EXPO_PUBLIC_*` set, e.g. via `.env.local`). |

Mobile is intentionally not part of `pnpm build` (that builds Web); `pnpm validate` covers mobile lint, typecheck, and tests.

## Builds (prepared, not exercised)

`eas.json` defines profiles `development`, `qa`, `staging`, `production`, each setting only `EXPO_PUBLIC_APP_ENV` (`dev`, `qa`, `stage`, `prod`; `/docs/deployment.md` section 8). Set `EXPO_PUBLIC_API_BASE_URL` (and later the Clerk publishable key) per profile as EAS environment variables. Store identifiers, signing credentials, EAS project linking, and OTA update policy are undecided. No EAS build has been run.

## Testing

Vitest covers pure TypeScript only. React Native component tests are not set up (see `/docs/testing.md`). The app has not been run on a simulator/device in CI; only Metro bundling for both platforms has been verified.

## Remaining scaffolding work

1. ~~Add `@clerk/expo`, secure token storage, and an API client.~~ Done in the foundation: `@clerk/expo` with the secure token cache (`expo-secure-store`), email and password sign-in, and the shared API client sending the session token as a bearer token. **Not yet proven on a physical device**: that needs the owner's `eas login` and a development build (Expo Go is not used for the proof). Native Clerk features (social sign-in, passkeys) are not set up.
2. Navigation: `expo-router` is configured and the app has a sign-in gate and one starting screen. Add screens and tabs with the first feature that needs them.
3. Decide store identifiers and EAS project setup.
4. Decide a component-test approach (for example `jest-expo`) when the first interactive component warrants it.
