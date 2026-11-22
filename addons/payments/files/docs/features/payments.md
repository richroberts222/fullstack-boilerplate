# Payments add-on

Offers with tiers and ways to pay, what each member holds, payments, coupons, scholarship amounts, grace period, a test checkout, and Stripe. Taken with `pnpm init:app --with=payments` (it needs `legal` and `audit`, which come with it) or applied to an existing application (`pnpm addon:apply`, task S18).

This add-on was lifted from a reviewed application that already runs it. **Do not change a money rule while adapting it**; a change to how prices, discounts, access or refunds work is an Opus task with tests (`/docs/lessons.md`).

## Vocabulary (the application fills in the nouns)

| Word | Meaning |
| --- | --- |
| offer | Something sold: a price in whole cents, a way to pay, a tier, what it unlocks. |
| scope | `everything`, `groups` or `parts`: what the offer unlocks. The ids are the application's own (a uuid per group or part); the add-on has no table for them. |
| tier | Basic, or upgraded (`includes_bonus`): upgraded also unlocks the bonus content attached to what is covered. |
| way to pay | `one_time` (full payment, or one fixed length of access with `access_days`), `monthly`, or `installments` (a plan with a set number of payments). |
| entitlement | What one member holds. Copied from the offer when granted, so a later edit never changes what someone bought. |

The application supplies one thing: a **scope catalog port** that answers "does this group or part exist, and which group does a part belong to?" (built in S14b; `lib/addons/payments.ts` is where an application wires its own).

## Built in this slice (S14a)

Tables (`apps/web/db/addons/payments.ts`): `offers`, `entitlements`, `payments`, `checkout_sessions`, `coupons`, `member_discounts`, `access_alert_prefs`, `billing_customers`. Contracts (`packages/validation/src/access.ts`, `pricing.ts`): offer, coupon, scholarship, refund, cancel and plan-change inputs, with no defaults on edits. Every column is in `docs/data-inventory.md` ("Payments (add-on)").

## Built in S14b: the services

`lib/services/access.ts` (offers, checkout, entitlements, grace period, refunds, plan changes; every owner change audited), `access-rules.ts`, `pricing.ts` (quote, coupons, scholarship amounts: server-side, whole cents, never below zero), their data access (`db/access.ts`, `db/pricing.ts`), the payment and notice ports (`lib/payments/ports.ts`, `lib/notices/ports.ts`), the owner rule (`lib/auth/site-owner.ts`), the add-on's settings contract (`packages/validation/src/payments-settings.ts`) and `access.test.ts` (the source application's access tests, renamed to groups and parts). The application's one job is `ScopeCatalog` (`lib/services/scope-catalog.ts`). Access checks are `canAccess` and `canAccessBonus` with `{ partId, groupId }`.

## Built in S14c: wiring and screens

Wiring in `lib/addons/payments.ts` (the base composition root is not edited); the application's one file is `lib/addons/payments-scopes.ts`. Screens: `/pricing` (public; per group, basic and upgraded side by side, a code field that asks the server for the price), `/checkout/dev/<token>` (the test checkout, only while `PAYMENTS_PROVIDER=dev`), "My access" and the grace-period notice on `/dashboard`, and for the owner `/admin` (links), `/admin/offers`, `/admin/coupons` and `/admin/payments` (list, part or full refund, stop a plan, CSV for the accountant). Group and part names on the owner and pricing screens come from the optional `choices` in `payments-scopes.ts`; without it the ids are shown. Every amount is shown in dollars and sent as cents; every rule is in the services, never in a screen. Navigation adds Pricing and Admin.

## Browser test and its known gaps

`e2e/payments.spec.ts` drives the owner screens and a purchase with the test checkout. It is skipped unless `PAYMENTS_E2E=1`; it needs `PAYMENTS_PROVIDER=dev` and `OWNER_USER_IDS` naming the E2E Clerk user (a throwaway database). It was written with the screens and has not yet been run against a live Clerk development instance. `docs/test-coverage-baseline.payments.json` lists the controls the dev checkout cannot reach (payment past due, resume, plan change and stop-plan buttons need Stripe; the grace banner needs a lapsed plan; empty states and error paths need a fresh account or a failing service). The list may only shrink, and S15 covers the Stripe ones.

## Still to come (tracked in the source application's `docs/notes.md`)

S15 Stripe adapter, webhook and billing; S18 applying an add-on to an existing application; then an Opus review of every money rule.
