# To-do: what only the owner can do right now

This file holds only the actions still waiting on you. Claude removes an item as soon as it finds the item is done, so if it is in this file, it is still open. The full steps are in `/docs/new-app-setup.md`.

**Rules.**

1. Never paste a password, secret key or token into the chat or into any file in the repository.
2. Anything that costs money: stop and ask Claude first.

## Product

- [ ] Put your specs in `docs/specs/`.
- [ ] Decide the branding. The colors are a neutral placeholder, and there is no logo or app icon yet (`/docs/customization-map.md`).
- [ ] Confirm the mobile bundle id. `com.example.appboilerplate` is a placeholder, and it is permanent once published to a store.

## Accounts and services (when you are ready to run it for real)

- [ ] Create the Clerk application.
- [ ] Create the Neon project.
- [ ] Create the Vercel project.
- [ ] Run `eas init` to link your own Expo project.

## GitHub

- [ ] Add the `Protect main` ruleset, blocking deletion and force-push only. Do not require a pull request or a passing check, or Claude's pushes to `main` are refused.
- [ ] Turn on Dependabot alerts.
- [ ] Add the E2E secrets. The browser-test workflow stays manual until specs and secrets exist.

## Waiting, no action yet: the next Android build

Claude never starts a build on its own. Phone-only changes that need a new build are listed here.

- Nothing yet.
