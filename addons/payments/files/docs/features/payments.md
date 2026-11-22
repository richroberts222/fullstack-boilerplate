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

## Still to come (tracked in the source application's `docs/notes.md`)

S14b the services (`access`, `access-rules`, `pricing`) with tests; S14c ports, the test checkout, wiring, screens; S15 Stripe adapter, webhook and billing; S18 applying an add-on to an existing application; then an Opus review of every money rule.
