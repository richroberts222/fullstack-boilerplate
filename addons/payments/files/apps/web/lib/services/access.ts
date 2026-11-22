import type {
  CompleteDevCheckoutInput,
  CreateOfferInput,
  DeleteOfferInput,
  GraceAlertActionInput,
  GrantScholarshipInput,
  PublicOffer,
  Quote,
  QuoteInput,
  RevokeGrantInput,
  Scope,
  SetLifetimeAccessInput,
  StartCheckoutInput,
  UpdateOfferInput, OwnerCancelPlanInput, RefundPaymentInput, ChangePlanTierInput } from "@app-boilerplate/validation";

import type { AccessRepo, CheckoutSessionRow, EntitlementRow, OfferRow, PaymentRecord } from "../../db/access";
import type { AuditRepo } from "../../db/settings";
import { authorize, type Rule } from "../auth/authorize";
import type { NoticesPort } from "../notices/ports";
import type { PaymentsPort } from "../payments/ports";
import type { PricingService } from "./pricing";
import type { ScopeCatalog } from "./scope-catalog";
import { accessState, addMonth, covers, coversBonus, DAY_MS, graceEndsAt, hasGracePeriod, type AccessState } from "./access-rules";
import type { AtomicRunner } from "./atomic";
import type { ServiceContext } from "./context";
import { DatabaseError } from "../../db/errors";
import { conflict, notFound, ServiceError, validationFailed, policyReacceptanceRequired } from "./errors";

// Access service (/docs/features/access-and-checkout.md, /docs/features/grace-period.md). The one place
// that decides who may access what, records payments, and runs the grace period. Adapters (payments,
// notices) and pages only carry its decisions. Every owner change is audited in the same atomic unit.

export type AccessDeps = {
  repo: AccessRepo;
  /** The application's own groups and parts (what an offer may unlock). */
  scopes: ScopeCatalog;
  audit: AuditRepo;
  atomic: AtomicRunner;
  payments: PaymentsPort;
  /** What a member pays (the pricing service): scholarship amount and coupon applied on the server. */
  pricing: Pick<PricingService, "quote" | "useCouponStatement">;
  notices: NoticesPort;
  isSiteOwner: Rule;
  /** The owner's grace settings, read fresh each time so a change applies at once. */
  graceSettings: () => Promise<{ gracePeriodDays: number; reminderSnoozeDays: number }>;
  now: () => Date;
  newId: () => string;
  /** An unguessable one-time checkout reference. */
  newToken: () => string;
  /** Whether this member accepted the Terms and Privacy Policy in force (/docs/features/legal-gate.md AC4). */
  hasAcceptedTerms: (userId: string) => Promise<boolean>;
  /** The member's email for the provider's customer record and receipts (O10b); null when unknown. */
  memberEmail: (userId: string) => Promise<string | null>;
  /** The owner's billing settings, read fresh: free trial days on a first monthly plan (O10b). */
  billingSettings: () => Promise<{ trialDays: number }>;
};

/** The longest free trial the settings allow (packages/validation settings `trialDays`). */
export const TRIAL_DAYS_MAX = 90;

/** How many plans the daily check looks at in one run. */
export const RECONCILE_LIMIT = 500;

export type TierChangePreview = { offerId: string; title: string; upgrade: boolean; newMonthlyCents: number; amountDueNowCents: number };

export type ReconcileDifference = { entitlementId: string; providerRef: string; problem: string };
export type ReconcileReport = { checked: number; skipped: number; failed: number; differences: ReconcileDifference[] };

/** A payment as the access service needs it, from any provider. */
export type PaymentNotice = {
  provider: string;
  providerPaymentId: string;
  amountCents: number;
  paidAt: Date;
};

export type MyAccessItem = {
  id: string;
  title: string;
  source: EntitlementRow["source"];
  billing: EntitlementRow["billing"];
  includesBonus: boolean;
  state: AccessState;
  /** When paid access ends; null when it never ends. */
  paidThrough: Date | null;
  /** When access ends after the grace period; null when there is no grace period. */
  graceEndsAt: Date | null;
  installmentsPaid: number;
  installmentCount: number;
  canceled: boolean;
  /** The member can stop future payments. */
  canCancel: boolean;
  /** The plan's latest payment failed: ask the member to update their card (O10). */
  paymentFailed: boolean;
  /** A stopped plan that has not reached its paid date yet: the member can start it again (O10). */
  canResume: boolean;
  /** The other tier of this monthly plan the member can move to (O10b), or null. */
  tierChange: { offerId: string; title: string; upgrade: boolean } | null;
};

export type GraceAlert = { entitlementId: string; title: string; graceEndsAt: Date; continueOfferId: string | null };

export type DevCheckout = { token: string; offer: PublicOffer; completed: boolean };

const AUDIT = {
  offerCreate: "offer.create",
  offerUpdate: "offer.update",
  offerDelete: "offer.delete",
  lifetimeGrant: "access.lifetime_grant",
  lifetimeRevoke: "access.lifetime_revoke",
  scholarshipGrant: "access.scholarship_grant",
  grantRevoke: "access.grant_revoke",
  paymentRefund: "payment.refund",
  paymentDispute: "payment.dispute",
  ownerCancel: "access.owner_cancel",
  tierChange: "access.tier_change",
} as const;

/** Who an audit entry names when the payment provider, not a person, caused the change. */
const PROVIDER_ACTOR = "system:payments";

const toPublicOffer = (o: OfferRow): PublicOffer => ({
  id: o.id,
  title: o.title,
  description: o.description,
  priceCents: o.priceCents,
  billing: o.billing,
  installmentCount: o.billing === "installments" ? o.installmentCount : 1,
  includesBonus: o.includesBonus,
  accessDays: o.billing === "one_time" ? o.accessDays : null,
  scope: o.scope,
  scopeIds: o.scopeIds,
});

export function createAccessService(deps: AccessDeps) {
  const { repo } = deps;
  const requireOwner = (ctx: ServiceContext) => authorize(ctx.actor, deps.isSiteOwner, undefined);
  const graceDays = async () => (await deps.graceSettings()).gracePeriodDays;
  const audit = (ctx: ServiceContext, action: string, subject: string, before: unknown, after: unknown) =>
    deps.audit.insertStatement({ id: deps.newId(), actorUserId: ctx.actor.userId, action, subject, before, after });
  const run = (operation: string, statements: unknown[]) => deps.atomic(operation, statements as never);

  /** Every listed id must be a real group or part, so an offer never unlocks nothing by mistake. */
  async function checkScope(scope: Scope, scopeIds: readonly string[]) {
    if (scope === "everything") return;
    const known = new Set(await deps.scopes.knownIds(scope));
    if (scopeIds.some((id) => !known.has(id))) throw validationFailed("Something chosen no longer exists", { scopeIds: ["Something chosen no longer exists; refresh and choose again"] });
  }

  async function requireOffer(id: string) {
    const offer = await repo.findOffer(id);
    if (!offer) throw notFound("Offer not found");
    return offer;
  }

  async function requireOwnPlan(ctx: ServiceContext, entitlementId: string) {
    const e = await repo.findEntitlement(entitlementId);
    // Someone else's plan is "not found", so ids cannot be probed.
    if (!e || e.userId !== ctx.actor.userId) throw notFound("Not found");
    return e;
  }

  const requireDev = () => {
    if (deps.payments.provider !== "dev") throw notFound("Not found");
  };

  /** The new entitlement and its first payment for a completed purchase, as statements. */
  function purchaseStatements(userId: string, offer: OfferRow, payment: PaymentNotice, providerRef: string | null, priceCents: number, trialEndsAt: Date | null = null) {
    const entitlementId = deps.newId();
    const recurring = offer.billing !== "one_time";
    const row: EntitlementRow = {
      id: entitlementId,
      userId,
      source: "purchase",
      offerId: offer.id,
      title: offer.title,
      scope: offer.scope,
      scopeIds: offer.scopeIds,
      billing: offer.billing,
      installmentCount: offer.billing === "installments" ? offer.installmentCount : 1,
      // A free trial is not a payment: nothing is paid until it ends.
      installmentsPaid: trialEndsAt ? 0 : 1,
      includesBonus: offer.includesBonus,
      // Monthly and payment plans are paid a month at a time; a one-time purchase lasts its set number
      // of days (one year = 365), or for good.
      paidThrough: trialEndsAt ?? (recurring ? addMonth(payment.paidAt) : offer.accessDays !== null ? new Date(payment.paidAt.getTime() + offer.accessDays * DAY_MS) : null),
      status: "active",
      priceCents,
      reason: null,
      grantedBy: null,
      providerRef: recurring ? providerRef : null,
      finalNoticeSentAt: null,
    };
    return {
      entitlementId,
      statements: [
        repo.insertEntitlementStatement(row),
        repo.insertPaymentStatement({ id: deps.newId(), userId, entitlementId, amountCents: payment.amountCents, provider: payment.provider, providerPaymentId: payment.providerPaymentId, paidAt: payment.paidAt }),
      ],
    };
  }

  /**
   * Grants what a checkout session bought, from a payment the provider (or the test checkout) confirmed.
   * A session completes once: a second completion, or one racing it, is a no-op (the payment id is
   * unique, so the racing unit is refused as a whole and reported as already done).
   */
  async function completeSession(session: CheckoutSessionRow, payment: PaymentNotice, providerRef: string | null, trialEndsAt: Date | null = null): Promise<{ entitlementId: string | null }> {
    if (session.status === "completed") return { entitlementId: null };
    const offer = await requireOffer(session.offerId);
    // The price quoted at the start of checkout is what is charged (null only on sessions from before coupons).
    const price = session.priceCents ?? offer.priceCents;
    // A free trial (O10b) pays nothing now: only a monthly plan, with an end the trial setting allows.
    const trial = trialEndsAt !== null && offer.billing === "monthly" && providerRef !== null && trialEndsAt > payment.paidAt && trialEndsAt.getTime() - payment.paidAt.getTime() <= (TRIAL_DAYS_MAX + 1) * DAY_MS;
    if (trialEndsAt !== null && !trial) throw conflict("The payment does not match the price.");
    if (!trial && payment.amountCents < price) throw conflict("The payment does not match the price.");
    const { entitlementId, statements } = purchaseStatements(session.userId, offer, payment, providerRef, price, trial ? trialEndsAt : null);
    const couponUse = session.couponId ? [deps.pricing.useCouponStatement(session.couponId)] : [];
    try {
      await run("access.purchase", [...statements, ...couponUse, repo.completeCheckoutSessionStatement(session.id, deps.now())]);
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === "unique_violation") return { entitlementId: null };
      throw error;
    }
    return { entitlementId };
  }

  async function recordRenewal(providerRef: string, payment: PaymentNotice): Promise<{ recorded: boolean; owned: boolean }> {
    const e = await repo.findEntitlementByProviderRef(providerRef);
    if (!e || e.source !== "purchase" || e.billing === "one_time" || e.status === "revoked") throw notFound("Plan not found");
    if (await repo.findPayment(payment.provider, payment.providerPaymentId)) return { recorded: false, owned: e.paidThrough === null };
    // A plan already owned (every installment paid) takes no more payments.
    if (e.paidThrough === null) return { recorded: false, owned: true };
    const base = e.paidThrough > payment.paidAt ? e.paidThrough : payment.paidAt;
    const installmentsPaid = e.installmentsPaid + 1;
    const owned = e.billing === "installments" && installmentsPaid >= e.installmentCount;
    await run("access.renewal", [
      repo.insertPaymentStatement({ id: deps.newId(), userId: e.userId, entitlementId: e.id, ...payment }),
      // A member who pays again is back: a later lapse gets its own final notice.
      repo.updateEntitlementStatement(e.id, { installmentsPaid, paidThrough: owned ? null : addMonth(base), finalNoticeSentAt: null, paymentFailedAt: null }),
    ]);
    return { recorded: true, owned };
  }

  /** A plan the provider still bills: a purchase paid over time that is not owned, ended or revoked yet. */
  const stillBilling = (e: EntitlementRow) => e.source === "purchase" && e.billing !== "one_time" && e.providerRef !== null && e.paidThrough !== null && e.status !== "revoked";

  /** The payment stored under any of the provider's ids for it. */
  async function findPaymentByIds(provider: string, ids: string[]): Promise<PaymentRecord | null> {
    for (const id of ids) {
      const p = await repo.findPayment(provider, id);
      if (p) return p;
    }
    return null;
  }

  /**
   * Money given back (O10). Records the payment's new refunded total (never lower than before, never above
   * what was paid). A full refund, or a dispute, ends the access that payment bought: the entitlement is
   * revoked and a plan still billing is stopped now. A partial refund changes no access.
   */
  async function applyMoneyBack(payment: PaymentRecord, refundedTotal: number, reason: "refund" | "dispute", actor: string, note: string | null): Promise<{ accessEnded: boolean }> {
    const total = Math.min(payment.amountCents, Math.max(payment.refundedCents, refundedTotal));
    const ends = reason === "dispute" || (payment.amountCents > 0 && total >= payment.amountCents);
    const e = await repo.findEntitlement(payment.entitlementId);
    const endNow = ends && e !== null && e.status !== "revoked";
    if (endNow && stillBilling(e)) await deps.payments.cancel(e.providerRef!, "now");
    const label = reason === "dispute" ? "Disputed with the bank" : "Refunded";
    if (total === payment.refundedCents && !endNow) return { accessEnded: false };
    await run(reason === "dispute" ? AUDIT.paymentDispute : AUDIT.paymentRefund, [
      repo.refundPaymentStatement(payment.id, total),
      ...(endNow ? [repo.updateEntitlementStatement(e.id, { status: "revoked", reason: note ? `${label}: ${note}` : label })] : []),
      deps.audit.insertStatement({
        id: deps.newId(),
        actorUserId: actor,
        action: reason === "dispute" ? AUDIT.paymentDispute : AUDIT.paymentRefund,
        subject: payment.id,
        before: { refundedCents: payment.refundedCents, status: e?.status ?? null },
        after: { refundedCents: total, status: endNow ? "revoked" : (e?.status ?? null), reason: note },
      }),
    ]);
    return { accessEnded: endNow };
  }

  /** The member's customer record at the provider, made on first use and reused after (O10b). Null for providers without one. */
  async function ensureCustomer(userId: string): Promise<string | null> {
    const provider = deps.payments.provider;
    const known = await repo.findBillingCustomer(userId, provider);
    if (known) return known;
    // The key names the member, so two checkouts started at once make one record.
    const created = await deps.payments.createCustomer({ userId, email: await deps.memberEmail(userId), idempotencyKey: `customer_${userId}` });
    if (!created) return null;
    await repo.saveBillingCustomer(userId, provider, created);
    // If another request stored one first, that one is kept and used.
    return (await repo.findBillingCustomer(userId, provider)) ?? created;
  }

  const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

  /** The other tier of the same monthly offer, for sale now: same scope and ids, monthly, the other bonus setting. */
  const otherTier = (e: EntitlementRow, offers: OfferRow[]) =>
    offers.find((o) => o.isActive && o.billing === "monthly" && o.scope === e.scope && sameIds(o.scopeIds, e.scopeIds) && o.includesBonus !== e.includesBonus) ?? null;

  /** A plan that can change tier: the member's own active monthly purchase, paid up, billed by the provider. */
  const canChangeTier = (e: EntitlementRow, state: AccessState) =>
    e.source === "purchase" && e.billing === "monthly" && e.status === "active" && state === "active" && e.providerRef !== null && e.paidThrough !== null;

  /** Checks a tier change and works out its price on the server (the scholarship applies; a coupon does not carry over). */
  async function tierChange(ctx: ServiceContext, input: ChangePlanTierInput) {
    // Money moves, so the Terms in force must be accepted, as at checkout (O4).
    if (!(await deps.hasAcceptedTerms(ctx.actor.userId))) throw policyReacceptanceRequired();
    const e = await requireOwnPlan(ctx, input.entitlementId);
    if (!canChangeTier(e, accessState(e, deps.now(), await graceDays()))) throw conflict("This plan cannot change tier. Choose on the pricing page instead.");
    const offer = await repo.findOffer(input.offerId);
    if (!offer || otherTier(e, [offer]) === null) throw conflict("That is not the other tier of this plan.");
    const { finalCents } = await deps.pricing.quote(ctx.actor.userId, offer, undefined);
    if (finalCents <= 0) throw conflict("A monthly plan cannot be made free this way; ask about a scholarship.");
    const current = e.priceCents ?? (e.offerId ? (await repo.findOffer(e.offerId))?.priceCents : null) ?? 0;
    return { e, offer, newMonthlyCents: finalCents, increase: finalCents > current };
  }

  return {
    // ----- Offers ---------------------------------------------------------------------------------

    /** What is for sale now, for the pricing page. Anyone may read it. */
    async getPublicOffers(): Promise<PublicOffer[]> {
      return (await repo.listOffers()).filter((o) => o.isActive).map(toPublicOffer);
    },

    async getOwnerOffers(ctx: ServiceContext): Promise<OfferRow[]> {
      await requireOwner(ctx);
      return repo.listOffers();
    },

    async createOffer(ctx: ServiceContext, input: CreateOfferInput): Promise<{ id: string }> {
      await requireOwner(ctx);
      await checkScope(input.scope, input.scopeIds);
      const row: OfferRow = {
        id: deps.newId(),
        ...input,
        installmentCount: input.billing === "installments" ? input.installmentCount : 1,
        accessDays: input.billing === "one_time" ? input.accessDays : null,
        position: await repo.nextOfferPosition(),
      };
      await run(AUDIT.offerCreate, [repo.insertOfferStatement(row), audit(ctx, AUDIT.offerCreate, row.id, null, row)]);
      return { id: row.id };
    },

    async updateOffer(ctx: ServiceContext, input: UpdateOfferInput): Promise<void> {
      await requireOwner(ctx);
      const before = await requireOffer(input.id);
      await checkScope(input.scope, input.scopeIds);
      const { id, ...fields } = input;
      const patch = { ...fields, installmentCount: fields.billing === "installments" ? fields.installmentCount : 1, accessDays: fields.billing === "one_time" ? fields.accessDays : null };
      await run(AUDIT.offerUpdate, [repo.updateOfferStatement(id, patch), audit(ctx, AUDIT.offerUpdate, id, before, { ...before, ...patch })]);
    },

    /** Deleting is only for an offer nobody has bought; otherwise the owner turns it off, so purchase records stay whole. */
    async deleteOffer(ctx: ServiceContext, input: DeleteOfferInput): Promise<void> {
      await requireOwner(ctx);
      const before = await requireOffer(input.id);
      if ((await repo.countEntitlementsForOffer(input.id)) > 0) throw conflict("Someone already has this. Turn it off instead of deleting it.");
      await run(AUDIT.offerDelete, [repo.deleteOfferStatement(input.id), audit(ctx, AUDIT.offerDelete, input.id, before, null)]);
    },

    // ----- Checkout -------------------------------------------------------------------------------

    /** Starts checkout for one offer and returns where to send the member. */
    async startCheckout(ctx: ServiceContext, input: StartCheckoutInput): Promise<{ redirectUrl: string }> {
      if (!(await deps.hasAcceptedTerms(ctx.actor.userId))) throw policyReacceptanceRequired();
      const offer = await repo.findOffer(input.offerId);
      if (!offer || !offer.isActive) throw notFound("This is not for sale right now");
      const now = deps.now();
      const days = await graceDays();
      const held = (await repo.listEntitlementsForUser(ctx.actor.userId)).filter((e) => accessState(e, now, days) === "active");
      if (held.some((e) => e.scope === "everything")) throw conflict("You already have access to everything.");
      // A member in the grace period may buy the same offer again: that is the "Continue here" path.
      if (held.some((e) => e.offerId === offer.id)) throw conflict("You already have this.");
      const quote = await deps.pricing.quote(ctx.actor.userId, offer, input.couponCode);
      const couponUse = quote.couponId ? [deps.pricing.useCouponStatement(quote.couponId)] : [];
      if (quote.finalCents === 0) {
        // Nothing to pay: grant now, with a zero payment on record. A plan billed over time cannot be
        // free this way (it would lapse after a month); the owner gives free access with a scholarship.
        if (offer.billing !== "one_time") throw validationFailed("A monthly plan or payment plan cannot be made free with a discount.", { couponCode: ["Ask about a scholarship instead"] });
        const { statements } = purchaseStatements(ctx.actor.userId, offer, { provider: "free", providerPaymentId: deps.newId(), amountCents: 0, paidAt: now }, null, 0);
        await run("access.purchase_free", [...statements, ...couponUse]);
        return { redirectUrl: "/dashboard" };
      }
      const token = deps.newToken();
      // A free trial only on a member's first purchase, and only for a monthly plan (O10b).
      const firstPurchase = !(await repo.listEntitlementsForUser(ctx.actor.userId)).some((e) => e.source === "purchase");
      const trialDays = offer.billing === "monthly" && firstPurchase ? Math.min(TRIAL_DAYS_MAX, (await deps.billingSettings()).trialDays) : 0;
      const customerId = await ensureCustomer(ctx.actor.userId);
      // Start the payment first: if the provider refuses (purchases closed), no session row is left behind.
      // The provider is told the computed price, never the list price.
      const { redirectUrl } = await deps.payments.startCheckout({ token, offer: { ...toPublicOffer(offer), priceCents: quote.finalCents }, customerId, trialDays });
      await repo.insertCheckoutSession({ id: deps.newId(), token, userId: ctx.actor.userId, offerId: offer.id, status: "open", priceCents: quote.finalCents, couponId: quote.couponId });
      return { redirectUrl };
    },

    /** What an offer for sale costs this viewer per payment, with an optional code (the pricing page). */
    async quote(ctx: ServiceContext | null, input: QuoteInput): Promise<Quote> {
      const offer = await repo.findOffer(input.offerId);
      if (!offer || !offer.isActive) throw notFound("This is not for sale right now");
      const q = await deps.pricing.quote(ctx?.actor.userId ?? null, offer, input.couponCode);
      return { offerId: q.offerId, listCents: q.listCents, scholarshipCents: q.scholarshipCents, couponCents: q.couponCents, finalCents: q.finalCents, couponCode: q.couponCode };
    },

    /** The test checkout page. Exists only with the dev payments adapter, and only for the member who started it. */
    async getDevCheckout(ctx: ServiceContext, token: string): Promise<DevCheckout> {
      requireDev();
      const session = await repo.findCheckoutSessionByToken(token);
      if (!session || session.userId !== ctx.actor.userId) throw notFound("Checkout not found");
      const offer = await requireOffer(session.offerId);
      return { token, offer: { ...toPublicOffer(offer), priceCents: session.priceCents ?? offer.priceCents }, completed: session.status === "completed" };
    },

    /** Completes the test checkout: records a payment of the offer's price and grants access. Completing twice grants once. */
    async completeDevCheckout(ctx: ServiceContext, input: CompleteDevCheckoutInput): Promise<{ entitlementId: string | null }> {
      requireDev();
      const session = await repo.findCheckoutSessionByToken(input.token);
      if (!session || session.userId !== ctx.actor.userId) throw notFound("Checkout not found");
      const offer = await requireOffer(session.offerId);
      // The session id is the payment id, so a second completion racing this one hits the unique payment index.
      const price = session.priceCents ?? offer.priceCents;
      return completeSession(session, { provider: "dev", providerPaymentId: session.id, amountCents: price, paidAt: deps.now() }, `dev_${session.id}`);
    },

    /**
     * The buyer is back from the provider's checkout page (`ctx` is them), or the provider notified us
     * (`ctx` null). Either way the provider is asked what was paid; nothing in the request is trusted.
     * Returns "pending" while the provider has not confirmed the payment yet.
     */
    async completeProviderCheckout(ctx: ServiceContext | null, providerSessionId: string): Promise<{ status: "granted" | "already" | "pending" }> {
      const completed = await deps.payments.getCompletedCheckout(providerSessionId);
      if (!completed) return { status: "pending" };
      const session = await repo.findCheckoutSessionByToken(completed.token);
      // Someone else's checkout is "not found", so session ids cannot be probed.
      if (!session || (ctx !== null && session.userId !== ctx.actor.userId)) throw notFound("Checkout not found");
      const { entitlementId } = await completeSession(session, completed.payment, completed.providerRef, completed.trialEndsAt ?? null);
      return { status: entitlementId ? "granted" : "already" };
    },

    /**
     * A notification from the payment provider. The adapter verifies the signature first. A renewal
     * for a plan we do not know yet is `not_found`, so the provider retries later (out-of-order safe).
     * When the last payment of a payment plan arrives, the provider stops charging.
     */
    async handlePaymentEvent(rawBody: string, signature: string | null): Promise<{ handled: boolean }> {
      const event = await deps.payments.readEvent(rawBody, signature);
      if (event.kind === "checkout_completed") {
        const { status } = await this.completeProviderCheckout(null, event.providerSessionId);
        if (status === "pending") throw new ServiceError("unavailable", "Not paid yet");
        return { handled: true };
      }
      if (event.kind === "renewal") {
        const { owned } = await recordRenewal(event.providerRef, event.payment);
        if (owned) await deps.payments.cancel(event.providerRef, "now");
        return { handled: true };
      }
      if (event.kind === "refunded" || event.kind === "disputed") {
        // Not known yet (out of order): not_found, so the provider retries later.
        const payment = await findPaymentByIds(deps.payments.provider, event.providerPaymentIds);
        if (!payment) throw notFound("Payment not found");
        if (event.kind === "refunded") await applyMoneyBack(payment, event.refundedCents, "refund", PROVIDER_ACTOR, null);
        else await applyMoneyBack(payment, payment.refundedCents, "dispute", PROVIDER_ACTOR, null);
        return { handled: true };
      }
      if (event.kind === "payment_failed" || event.kind === "plan_changed" || event.kind === "plan_ended") {
        // A plan we do not hold (or one already ended here) is ignored rather than retried forever.
        const e = await repo.findEntitlementByProviderRef(event.providerRef);
        if (!e || e.source !== "purchase" || e.status === "revoked" || e.paidThrough === null) return { handled: false };
        if (event.kind === "payment_failed") {
          // The grace period already keeps access; this only asks the member to update their card.
          if (e.paymentFailedAt) return { handled: true };
          await run("access.payment_failed", [repo.updateEntitlementStatement(e.id, { paymentFailedAt: deps.now() })]);
          return { handled: true };
        }
        // Stopped at the provider (by the member, the owner, or the provider's dashboard): no more payments;
        // access runs to the paid date, then the grace period. Undone before the end: billing again.
        const stop = event.kind === "plan_ended" || event.cancelAtPeriodEnd;
        const status = stop ? "canceled" : "active";
        if (e.status !== status) await run("access.plan_sync", [repo.updateEntitlementStatement(e.id, { status })]);
        return { handled: true };
      }
      return { handled: false };
    },

    /**
     * A later payment of a monthly plan or payment plan (from the provider; the dev adapter's test button).
     * A repeated notice is recorded once. Monthly: paid a month further. Payment plan: when the last
     * payment arrives, it is owned for good.
     */
    recordRenewal,

    /** Test-only: pays the next payment of the member's own plan, so the flow can be tried without a provider. */
    async payNextDevPayment(ctx: ServiceContext, entitlementId: string): Promise<void> {
      requireDev();
      const e = await requireOwnPlan(ctx, entitlementId);
      if (!e.providerRef || e.status !== "active") throw conflict("This plan has no next payment.");
      const offer = e.offerId ? await repo.findOffer(e.offerId) : null;
      await recordRenewal(e.providerRef, { provider: "dev", providerPaymentId: deps.newId(), amountCents: e.priceCents ?? offer?.priceCents ?? 0, paidAt: deps.now() });
    },

    /** The member stops future payments of their own plan. Access continues to the paid date, then the grace period. */
    async cancelPlan(ctx: ServiceContext, entitlementId: string): Promise<void> {
      const e = await requireOwnPlan(ctx, entitlementId);
      if (e.status !== "active" || !hasGracePeriod(e) || e.paidThrough === null) throw conflict("There is nothing to cancel on this one.");
      if (e.providerRef) await deps.payments.cancel(e.providerRef, "period_end");
      await run("access.cancel", [repo.updateEntitlementStatement(e.id, { status: "canceled" })]);
    },

    /** The member starts a stopped plan again before its paid date (O10). Nothing is charged until the next due date. */
    async resumePlan(ctx: ServiceContext, entitlementId: string): Promise<void> {
      // Payments start again, so the Terms in force must be accepted, as at checkout (O4).
      if (!(await deps.hasAcceptedTerms(ctx.actor.userId))) throw policyReacceptanceRequired();
      const e = await requireOwnPlan(ctx, entitlementId);
      if (e.status !== "canceled" || !hasGracePeriod(e) || e.paidThrough === null || e.paidThrough <= deps.now()) throw conflict("This plan cannot be started again; choose it on the pricing page instead.");
      if (e.providerRef) await deps.payments.resume(e.providerRef);
      await run("access.resume", [repo.updateEntitlementStatement(e.id, { status: "active" })]);
    },

    /** Whether the member has a billing page at the provider (they paid there before). */
    async canManageBilling(ctx: ServiceContext): Promise<boolean> {
      if (deps.payments.provider !== "stripe") return false;
      return (await repo.findBillingCustomer(ctx.actor.userId, deps.payments.provider)) !== null;
    },

    /** "Manage billing" (O10b): the provider's page for the member's card, invoices, receipts and cancel. */
    async openBillingPortal(ctx: ServiceContext): Promise<{ url: string }> {
      const customerId = await repo.findBillingCustomer(ctx.actor.userId, deps.payments.provider);
      if (!customerId) throw conflict("There is no billing history yet.");
      return deps.payments.billingPortal(customerId);
    },

    /** What moving the member's monthly plan to its other tier costs: the new monthly price and what is charged now (O10b). */
    async previewTierChange(ctx: ServiceContext, input: ChangePlanTierInput): Promise<TierChangePreview> {
      const { e, offer, newMonthlyCents, increase } = await tierChange(ctx, input);
      const { amountDueNowCents } = increase ? await deps.payments.previewPlanChange(e.providerRef!, newMonthlyCents) : { amountDueNowCents: 0 };
      return { offerId: offer.id, title: offer.title, upgrade: offer.includesBonus, newMonthlyCents, amountDueNowCents };
    },

    /**
     * Moves the member's monthly plan to its other tier (O10b). The provider changes the price first (an
     * increase is charged now, prorated); the tier here changes only once the provider confirms it.
     */
    async changeTier(ctx: ServiceContext, input: ChangePlanTierInput): Promise<{ status: "changed" | "payment_needed" }> {
      const { e, offer, newMonthlyCents, increase } = await tierChange(ctx, input);
      const { applied } = await deps.payments.changePlan(e.providerRef!, { priceCents: newMonthlyCents, title: offer.title, increase, idempotencyKey: `tier_${e.id}_${deps.newId()}` });
      if (!applied) return { status: "payment_needed" };
      const patch = { offerId: offer.id, title: offer.title, includesBonus: offer.includesBonus, priceCents: newMonthlyCents };
      await run(AUDIT.tierChange, [
        repo.changePlanOfferStatement(e.id, patch),
        audit(ctx, AUDIT.tierChange, e.id, { offerId: e.offerId, includesBonus: e.includesBonus, priceCents: e.priceCents }, patch),
      ]);
      return { status: "changed" };
    },

    /**
     * The daily check (O10b): compares every plan still billing with the provider and reports differences.
     * It changes nothing: the owner decides. A plan the provider cannot be asked about counts as failed.
     */
    async reconcileBilling(): Promise<ReconcileReport> {
      const report: ReconcileReport = { checked: 0, skipped: 0, failed: 0, differences: [] };
      for (const e of await repo.listBillingPlans(RECONCILE_LIMIT)) {
        const ref = e.providerRef!;
        let plan;
        try {
          plan = await deps.payments.getPlan(ref);
        } catch {
          report.failed++;
          continue;
        }
        if (!plan) {
          report.skipped++;
          continue;
        }
        report.checked++;
        const add = (problem: string) => report.differences.push({ entitlementId: e.id, providerRef: ref, problem });
        const billingThere = ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(plan.status) && !plan.cancelAtPeriodEnd;
        if (plan.status === "canceled" || plan.status === "incomplete_expired") {
          if (e.status === "active") add("Ended at the payment provider, still active here");
        } else if (e.status === "canceled" && billingThere) add("Stopped here, still billing at the payment provider");
        else if (e.status === "active" && plan.cancelAtPeriodEnd) add("Set to stop at the payment provider, active here");
        if ((plan.status === "past_due" || plan.status === "unpaid") && !e.paymentFailedAt) add("Past due at the payment provider, not marked here");
        if (plan.unitAmountCents !== null && e.priceCents !== null && plan.unitAmountCents !== e.priceCents) add(`Price differs: ${plan.unitAmountCents} cents there, ${e.priceCents} cents here`);
      }
      return report;
    },

    /** The owner stops a member's plan: at the end of the paid period, or now, which ends access now (O10). Audited. */
    async ownerCancelPlan(ctx: ServiceContext, input: OwnerCancelPlanInput): Promise<void> {
      await requireOwner(ctx);
      const e = await repo.findEntitlement(input.entitlementId);
      if (!e || !stillBilling(e)) throw conflict("There is no plan to stop on this one.");
      await deps.payments.cancel(e.providerRef!, input.when);
      const patch = input.when === "now" ? ({ status: "revoked", reason: `Stopped by the owner: ${input.reason}` } as const) : ({ status: "canceled" } as const);
      await run(AUDIT.ownerCancel, [repo.updateEntitlementStatement(e.id, patch), audit(ctx, AUDIT.ownerCancel, e.id, { status: e.status }, { ...patch, when: input.when, reason: input.reason })]);
    },

    /**
     * The owner refunds part or all of a payment through the provider (O10). A full refund ends the access
     * it bought (and stops that plan); a partial one changes no access. Audited. The provider's later
     * notice of the same refund changes nothing more.
     */
    async refundPayment(ctx: ServiceContext, input: RefundPaymentInput): Promise<{ refundedCents: number; accessEnded: boolean }> {
      await requireOwner(ctx);
      const payment = await repo.findPaymentById(input.paymentId);
      if (!payment) throw notFound("Payment not found");
      const left = payment.amountCents - payment.refundedCents;
      if (left <= 0) throw conflict("This payment is already fully refunded.");
      const amount = input.amountCents ?? left;
      if (amount > left) throw validationFailed("More than is left to refund", { amountCents: [`At most ${left} cents`] });
      // The key names this exact refund, so a double click or a retry refunds once.
      await deps.payments.refund(payment.providerPaymentId, amount, `refund_${payment.id}_${payment.refundedCents}_${amount}`);
      const { accessEnded } = await applyMoneyBack(payment, payment.refundedCents + amount, "refund", ctx.actor.userId, input.reason);
      return { refundedCents: payment.refundedCents + amount, accessEnded };
    },

    // ----- Access checks -------------------------------------------------------------------------------

    /** Whether this member holds access (active or in the grace period) to a part of what is sold. */
    async canAccess(userId: string, target: { partId: string; groupId: string }): Promise<boolean> {
      const now = deps.now();
      const days = await graceDays();
      return (await repo.listEntitlementsForUser(userId)).some((e) => accessState(e, now, days) !== "ended" && covers(e, target));
    },

    /**
     * Whether this member may use the bonus content attached to a part: the same
     * active-or-grace rule as `canAccess`, and the access must be the upgraded tier.
     */
    async canAccessBonus(userId: string, target: { partId: string; groupId: string }): Promise<boolean> {
      const now = deps.now();
      const days = await graceDays();
      return (await repo.listEntitlementsForUser(userId)).some((e) => accessState(e, now, days) !== "ended" && coversBonus(e, target));
    },

    /** The member's own access, for their account page. Revoked grants are not shown. */
    async getMyAccess(ctx: ServiceContext): Promise<MyAccessItem[]> {
      const now = deps.now();
      const days = await graceDays();
      const offers = await repo.listOffers();
      return (await repo.listEntitlementsForUser(ctx.actor.userId))
        .filter((e) => e.status !== "revoked")
        .map((e) => {
          const state = accessState(e, now, days);
          return {
            id: e.id,
            title: e.title,
            source: e.source,
            billing: e.billing,
            includesBonus: e.includesBonus,
            state,
            paidThrough: e.paidThrough,
            graceEndsAt: graceEndsAt(e, days),
            installmentsPaid: e.installmentsPaid,
            installmentCount: e.installmentCount,
            canceled: e.status === "canceled",
            canCancel: e.status === "active" && hasGracePeriod(e) && e.paidThrough !== null && state !== "ended",
            paymentFailed: e.status !== "revoked" && state !== "ended" && Boolean(e.paymentFailedAt),
            canResume: e.status === "canceled" && hasGracePeriod(e) && e.paidThrough !== null && e.paidThrough > now,
            tierChange: (() => {
              const o = canChangeTier(e, state) ? otherTier(e, offers) : null;
              return o ? { offerId: o.id, title: o.title, upgrade: o.includesBonus } : null;
            })(),
          };
        });
    },

    // ----- Owner grants ---------------------------------------------------------------------------

    /** The free-lifetime checkbox: on grants everything for good; off revokes it. Both are audited. */
    async setLifetimeAccess(ctx: ServiceContext, input: SetLifetimeAccessInput): Promise<{ changed: boolean }> {
      await requireOwner(ctx);
      const current = (await repo.listEntitlementsForUser(input.userId)).filter((e) => e.source === "owner_lifetime" && e.status !== "revoked");
      if (input.enabled) {
        if (current.length > 0) return { changed: false };
        const row: EntitlementRow = {
          id: deps.newId(),
          userId: input.userId,
          source: "owner_lifetime",
          offerId: null,
          title: "Lifetime access (a gift)",
          scope: "everything",
          scopeIds: [],
          billing: "one_time",
          installmentCount: 1,
          installmentsPaid: 0,
          includesBonus: true,
          paidThrough: null,
          status: "active",
          priceCents: null,
          reason: null,
          grantedBy: ctx.actor.userId,
          providerRef: null,
          finalNoticeSentAt: null,
        };
        await run(AUDIT.lifetimeGrant, [repo.insertEntitlementStatement(row), audit(ctx, AUDIT.lifetimeGrant, row.id, null, { userId: input.userId })]);
        return { changed: true };
      }
      if (current.length === 0) return { changed: false };
      await run(
        AUDIT.lifetimeRevoke,
        current.flatMap((e) => [repo.updateEntitlementStatement(e.id, { status: "revoked" }), audit(ctx, AUDIT.lifetimeRevoke, e.id, { status: e.status }, { status: "revoked" })]),
      );
      return { changed: true };
    },

    /** A scholarship: free access to what the owner chooses, until a date or for good, with the reason recorded. */
    async grantScholarship(ctx: ServiceContext, input: GrantScholarshipInput): Promise<{ id: string }> {
      await requireOwner(ctx);
      await checkScope(input.scope, input.scopeIds);
      // Access lasts through the whole end date (UTC).
      const paidThrough = input.endsOn === null ? null : new Date(Date.parse(`${input.endsOn}T00:00:00Z`) + DAY_MS);
      if (paidThrough !== null && (Number.isNaN(paidThrough.getTime()) || paidThrough <= deps.now())) throw validationFailed("Choose a date in the future", { endsOn: ["Choose a date in the future"] });
      const row: EntitlementRow = {
        id: deps.newId(),
        userId: input.userId,
        source: "scholarship",
        offerId: null,
        title: "Scholarship",
        scope: input.scope,
        scopeIds: input.scopeIds,
        billing: "one_time",
        installmentCount: 1,
        installmentsPaid: 0,
        includesBonus: input.includesBonus,
        paidThrough,
        status: "active",
        priceCents: null,
        reason: input.reason,
        grantedBy: ctx.actor.userId,
        providerRef: null,
        finalNoticeSentAt: null,
      };
      await run(AUDIT.scholarshipGrant, [repo.insertEntitlementStatement(row), audit(ctx, AUDIT.scholarshipGrant, row.id, null, { userId: input.userId, scope: input.scope, scopeIds: input.scopeIds, endsOn: input.endsOn, includesBonus: input.includesBonus, reason: input.reason })]);
      return { id: row.id };
    },

    /** Ends an owner grant (lifetime or scholarship). Purchases are not revoked here: a refund goes through the payment provider. */
    async revokeGrant(ctx: ServiceContext, input: RevokeGrantInput): Promise<void> {
      await requireOwner(ctx);
      const e = await repo.findEntitlement(input.entitlementId);
      if (!e) throw notFound("Not found");
      if (e.source === "purchase") throw conflict("A purchase is ended by refunding it, not here.");
      if (e.status === "revoked") return;
      await run(AUDIT.grantRevoke, [repo.updateEntitlementStatement(e.id, { status: "revoked", reason: input.reason }), audit(ctx, AUDIT.grantRevoke, e.id, { status: e.status }, { status: "revoked", reason: input.reason })]);
    },

    /** Everything one member holds, for the owner. */
    async getMemberAccess(ctx: ServiceContext, userId: string): Promise<(EntitlementRow & { state: AccessState })[]> {
      await requireOwner(ctx);
      const now = deps.now();
      const days = await graceDays();
      return (await repo.listEntitlementsForUser(userId)).map((e) => ({ ...e, state: accessState(e, now, days) }));
    },

    // ----- Grace period ---------------------------------------------------------------------------

    /**
     * The gentle banner, or null. Shown when a paid plan is in its grace period and the member has not
     * already continued it, unless they snoozed it (until the snooze ends) or dismissed it for good.
     */
    async getGraceAlert(ctx: ServiceContext): Promise<GraceAlert | null> {
      const now = deps.now();
      const days = await graceDays();
      const all = await repo.listEntitlementsForUser(ctx.actor.userId);
      const continued = (e: EntitlementRow) => all.some((o) => o.id !== e.id && o.offerId !== null && o.offerId === e.offerId && accessState(o, now, days) === "active");
      const inGrace = all.find((e) => accessState(e, now, days) === "grace" && !continued(e));
      if (!inGrace) return null;
      const prefs = await repo.getAlertPrefs(ctx.actor.userId);
      if (prefs.dismissedForeverAt !== null) return null;
      if (prefs.snoozedUntil !== null && prefs.snoozedUntil > now) return null;
      const offer = inGrace.offerId ? await repo.findOffer(inGrace.offerId) : null;
      return { entitlementId: inGrace.id, title: inGrace.title, graceEndsAt: graceEndsAt(inGrace, days) as Date, continueOfferId: offer?.isActive ? offer.id : null };
    },

    /** "Remind me in a few days" hides it for the snooze setting; "Don't show this again" hides it for good, on every device. */
    async answerGraceAlert(ctx: ServiceContext, input: GraceAlertActionInput): Promise<void> {
      const now = deps.now();
      const prefs = await repo.getAlertPrefs(ctx.actor.userId);
      if (input.action === "dismiss_forever") {
        await repo.saveAlertPrefs(ctx.actor.userId, { ...prefs, dismissedForeverAt: prefs.dismissedForeverAt ?? now });
        return;
      }
      const { reminderSnoozeDays } = await deps.graceSettings();
      await repo.saveAlertPrefs(ctx.actor.userId, { ...prefs, snoozedUntil: new Date(now.getTime() + reminderSnoozeDays * DAY_MS) });
    },

    /**
     * Sends the one quiet final notice for every paid plan whose grace period has ended, to everyone,
     * including members who dismissed the banner. Marked before sending, so a notice is never sent twice.
     * A member who already bought the same offer again is marked without a notice.
     */
    async sendAccessEndedNotices(): Promise<{ sent: number; skipped: number }> {
      const now = deps.now();
      const days = await graceDays();
      const ended = await repo.listEndedWithoutNotice(new Date(now.getTime() - days * DAY_MS));
      let sent = 0;
      let skipped = 0;
      for (const e of ended) {
        if (accessState(e, now, days) !== "ended") continue;
        await run("access.final_notice", [repo.updateEntitlementStatement(e.id, { finalNoticeSentAt: now })]);
        const others = await repo.listEntitlementsForUser(e.userId);
        if (others.some((o) => o.id !== e.id && o.offerId === e.offerId && accessState(o, now, days) === "active")) {
          skipped++;
          continue;
        }
        try {
          await deps.notices.accessEnded({ userId: e.userId, entitlementId: e.id, title: e.title });
          sent++;
        } catch {
          // At most once by design: a failed send is not retried, and the job carries on.
          skipped++;
        }
      }
      return { sent, skipped };
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
