import type { CreateCouponInput, DiscountKind, GrantDiscountInput, Quote, RevokeDiscountInput, UpdateCouponInput } from "@app-boilerplate/validation";

import type { OfferRow } from "../../db/access";
import type { CouponRow, DiscountRow, PricingRepo } from "../../db/pricing";
import type { AuditRepo } from "../../db/settings";
import { authorize, type Rule } from "../auth/authorize";
import { DAY_MS } from "./access-rules";
import type { AtomicRunner } from "./atomic";
import type { ServiceContext } from "./context";
import { conflict, notFound, validationFailed } from "./errors";

// Pricing (/docs/features/access-and-checkout.md, O7). The one place that computes what a member pays:
// the offer's price, then their scholarship amount (the largest one that applies), then a coupon. All
// in whole cents, never below zero. Clients never send a price; the checkout charges this result.

export type PricingDeps = {
  repo: PricingRepo;
  audit: AuditRepo;
  atomic: AtomicRunner;
  isSiteOwner: Rule;
  now: () => Date;
  newId: () => string;
};

/** Cents a discount takes off a price. A percent rounds to the nearest cent; never more than the price. */
export function reduction(kind: DiscountKind, value: number, cents: number): number {
  const off = kind === "percent" ? Math.round((cents * value) / 100) : value;
  return Math.max(0, Math.min(cents, off));
}

const appliesTo = (d: { offerIds: string[] }, offerId: string) => d.offerIds.length === 0 || d.offerIds.includes(offerId);
const notEnded = (endsAt: Date | null, now: Date) => endsAt === null || now < endsAt;
/** The last day (UTC) a discount works, as the moment it stops: the start of the next day. */
const endOfDay = (endsOn: string | null) => (endsOn === null ? null : new Date(Date.parse(`${endsOn}T00:00:00Z`) + DAY_MS));

/** Why a coupon cannot be used now, or null when it can. One message for every reason a code is unusable, so codes cannot be probed. */
export function couponProblem(c: CouponRow | null, offerId: string, now: Date): string | null {
  if (!c || !c.isActive || !notEnded(c.endsAt, now) || (c.maxUses !== null && c.usedCount >= c.maxUses) || !appliesTo(c, offerId)) return "This code does not work for this.";
  return null;
}

const AUDIT = { couponCreate: "coupon.create", couponUpdate: "coupon.update", discountGrant: "discount.grant", discountRevoke: "discount.revoke" } as const;

export function createPricingService(deps: PricingDeps) {
  const { repo } = deps;
  const requireOwner = (ctx: ServiceContext) => authorize(ctx.actor, deps.isSiteOwner, undefined);
  const audit = (ctx: ServiceContext, action: string, subject: string, before: unknown, after: unknown) =>
    deps.audit.insertStatement({ id: deps.newId(), actorUserId: ctx.actor.userId, action, subject, before, after });
  const run = (operation: string, statements: unknown[]) => deps.atomic(operation, statements as never);

  function checkDates(endsAt: Date | null) {
    if (endsAt !== null && (Number.isNaN(endsAt.getTime()) || endsAt <= deps.now())) throw validationFailed("Choose a date in the future", { endsOn: ["Choose a date in the future"] });
  }

  return {
    /**
     * What this offer costs this viewer per payment, with an optional code. A visitor (null) gets no
     * scholarship amount. An unusable code is `validation_failed` with one message for every reason.
     */
    async quote(userId: string | null, offer: Pick<OfferRow, "id" | "priceCents">, couponCode: string | undefined): Promise<Quote & { couponId: string | null }> {
      const now = deps.now();
      const list = offer.priceCents;
      const discounts: DiscountRow[] = userId ? await repo.listDiscountsForUser(userId) : [];
      const scholarshipCents = discounts
        .filter((d) => d.status === "active" && notEnded(d.endsAt, now) && appliesTo(d, offer.id))
        .reduce((best, d) => Math.max(best, reduction(d.kind, d.value, list)), 0);
      let couponCents = 0;
      let coupon: CouponRow | null = null;
      if (couponCode !== undefined) {
        coupon = await repo.findCouponByCode(couponCode);
        const problem = couponProblem(coupon, offer.id, now);
        if (problem) throw validationFailed(problem, { couponCode: [problem] });
        couponCents = reduction(coupon!.kind, coupon!.value, list - scholarshipCents);
      }
      return {
        offerId: offer.id,
        listCents: list,
        scholarshipCents,
        couponCents,
        finalCents: Math.max(0, list - scholarshipCents - couponCents),
        couponCode: coupon?.code ?? null,
        couponId: coupon?.id ?? null,
      };
    },

    /** Counts one use of a coupon; the caller puts it in the purchase's atomic unit. */
    useCouponStatement: (couponId: string) => repo.useCouponStatement(couponId),

    // ----- Owner: coupons ------------------------------------------------------------------------

    async listCoupons(ctx: ServiceContext): Promise<CouponRow[]> {
      await requireOwner(ctx);
      return repo.listCoupons();
    },

    async createCoupon(ctx: ServiceContext, input: CreateCouponInput): Promise<{ id: string }> {
      await requireOwner(ctx);
      const endsAt = endOfDay(input.endsOn);
      checkDates(endsAt);
      if (await repo.findCouponByCode(input.code)) throw conflict("That code already exists.");
      const row: CouponRow = { id: deps.newId(), code: input.code, kind: input.kind, value: input.value, offerIds: input.offerIds, endsAt, maxUses: input.maxUses, usedCount: 0, isActive: input.isActive };
      await run(AUDIT.couponCreate, [repo.insertCouponStatement(row), audit(ctx, AUDIT.couponCreate, row.id, null, row)]);
      return { id: row.id };
    },

    async updateCoupon(ctx: ServiceContext, input: UpdateCouponInput): Promise<void> {
      await requireOwner(ctx);
      const before = await repo.findCoupon(input.id);
      if (!before) throw notFound("Code not found");
      const endsAt = endOfDay(input.endsOn);
      // An end date already passed is allowed when it is unchanged (editing an expired code's other fields).
      if (endsAt?.getTime() !== before.endsAt?.getTime()) checkDates(endsAt);
      const patch = { kind: input.kind, value: input.value, offerIds: input.offerIds, endsAt, maxUses: input.maxUses, isActive: input.isActive };
      await run(AUDIT.couponUpdate, [repo.updateCouponStatement(input.id, patch), audit(ctx, AUDIT.couponUpdate, input.id, before, { ...before, ...patch })]);
    },

    // ----- Owner: scholarship amounts ------------------------------------------------------------

    async listDiscounts(ctx: ServiceContext, userId: string): Promise<DiscountRow[]> {
      await requireOwner(ctx);
      return repo.listDiscountsForUser(userId);
    },

    async grantDiscount(ctx: ServiceContext, input: GrantDiscountInput): Promise<{ id: string }> {
      await requireOwner(ctx);
      const endsAt = endOfDay(input.endsOn);
      checkDates(endsAt);
      const row: DiscountRow = { id: deps.newId(), userId: input.userId, kind: input.kind, value: input.value, offerIds: input.offerIds, endsAt, reason: input.reason, grantedBy: ctx.actor.userId, status: "active" };
      await run(AUDIT.discountGrant, [repo.insertDiscountStatement(row), audit(ctx, AUDIT.discountGrant, row.id, null, row)]);
      return { id: row.id };
    },

    async revokeDiscount(ctx: ServiceContext, input: RevokeDiscountInput): Promise<void> {
      await requireOwner(ctx);
      const before = await repo.findDiscount(input.id);
      if (!before) throw notFound("Not found");
      if (before.status === "revoked") return;
      await run(AUDIT.discountRevoke, [repo.revokeDiscountStatement(input.id, input.reason), audit(ctx, AUDIT.discountRevoke, input.id, before, { status: "revoked", reason: input.reason })]);
    },
  };
}

export type PricingService = ReturnType<typeof createPricingService>;
