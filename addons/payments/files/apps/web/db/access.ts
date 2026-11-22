import type { Billing, Scope } from "@app-boilerplate/validation";
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, max, ne, sql } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { accessAlertPrefs, billingCustomers, checkoutSessions, entitlements, offers, payments } from "./addons/payments";

// Access data access (/docs/database.md section 8): offers, entitlements, payments, checkout sessions
// and the grace banner's answers. The only code that queries these tables; rows are mapped to plain
// types so the schema does not leak into services. Writes that must happen together are returned as
// statements for the service's atomic runner.

type Statement = Parameters<Database["batch"]>[0][number];

export type OfferRow = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  billing: Billing;
  installmentCount: number;
  scope: Scope;
  scopeIds: string[];
  /** Upgraded tier: also unlocks bonus content. */
  includesBonus: boolean;
  /** One-time offers: days of access (365 = one year); null means for good. */
  accessDays: number | null;
  isActive: boolean;
  position: number;
};
export type OfferPatch = Omit<OfferRow, "id" | "position">;

export type EntitlementSource = "purchase" | "owner_lifetime" | "scholarship";
export type EntitlementStatus = "active" | "canceled" | "revoked";

export type EntitlementRow = {
  id: string;
  userId: string;
  source: EntitlementSource;
  offerId: string | null;
  title: string;
  scope: Scope;
  scopeIds: string[];
  billing: Billing;
  installmentCount: number;
  installmentsPaid: number;
  /** Whether this access also unlocks bonus content (copied from the offer, or chosen for a grant). */
  includesBonus: boolean;
  /** When paid access ends; null means it never ends. */
  paidThrough: Date | null;
  status: EntitlementStatus;
  /** The price agreed per payment (after a scholarship amount and a coupon); null on grants and on rows from before coupons. */
  priceCents: number | null;
  reason: string | null;
  grantedBy: string | null;
  providerRef: string | null;
  finalNoticeSentAt: Date | null;
  /** When the plan's latest payment failed (past due); null when paid up. Read from the database; new rows start null. */
  paymentFailedAt?: Date | null;
};
export type EntitlementPatch = Partial<Pick<EntitlementRow, "installmentsPaid" | "paidThrough" | "status" | "reason" | "finalNoticeSentAt" | "paymentFailedAt">>;

export type PaymentRow = {
  id: string;
  userId: string;
  entitlementId: string;
  amountCents: number;
  provider: string;
  providerPaymentId: string;
  paidAt: Date;
};

/** A stored payment, with how much of it has been refunded. */
export type PaymentRecord = PaymentRow & { refundedCents: number };

export type CheckoutSessionRow = {
  id: string;
  token: string;
  userId: string;
  offerId: string;
  status: "open" | "completed";
  /** The price quoted when checkout started (null on rows from before coupons: use the offer's price). */
  priceCents: number | null;
  couponId: string | null;
};

export type AlertPrefs = { dismissedForeverAt: Date | null; snoozedUntil: Date | null };

export type AccessRepo = {
  listOffers(): Promise<OfferRow[]>;
  findOffer(id: string): Promise<OfferRow | null>;
  nextOfferPosition(): Promise<number>;
  insertOfferStatement(row: OfferRow): Statement;
  updateOfferStatement(id: string, patch: OfferPatch): Statement;
  deleteOfferStatement(id: string): Statement;
  countEntitlementsForOffer(offerId: string): Promise<number>;

  listEntitlementsForUser(userId: string): Promise<EntitlementRow[]>;
  findEntitlement(id: string): Promise<EntitlementRow | null>;
  findEntitlementByProviderRef(providerRef: string): Promise<EntitlementRow | null>;
  /** Paid plans whose access ended before `endedBefore` and whose final notice is not sent yet. */
  listEndedWithoutNotice(endedBefore: Date): Promise<EntitlementRow[]>;
  insertEntitlementStatement(row: EntitlementRow): Statement;
  updateEntitlementStatement(id: string, patch: EntitlementPatch): Statement;

  findPayment(provider: string, providerPaymentId: string): Promise<PaymentRecord | null>;
  findPaymentById(id: string): Promise<PaymentRecord | null>;
  /** Sets the total refunded on a payment (O10). */
  refundPaymentStatement(id: string, refundedCents: number): Statement;
  insertPaymentStatement(row: PaymentRow): Statement;

  insertCheckoutSession(row: CheckoutSessionRow): Promise<void>;
  findCheckoutSessionByToken(token: string): Promise<CheckoutSessionRow | null>;
  completeCheckoutSessionStatement(id: string, at: Date): Statement;

  getAlertPrefs(userId: string): Promise<AlertPrefs>;
  saveAlertPrefs(userId: string, prefs: AlertPrefs): Promise<void>;

  /** The provider's customer id for this member (O10b), or null before their first checkout. */
  findBillingCustomer(userId: string, provider: string): Promise<string | null>;
  /** Stores it; a second store for the same member and provider keeps the first. */
  saveBillingCustomer(userId: string, provider: string, providerCustomerId: string): Promise<void>;
  /** Plans the provider still bills (monthly or payment plan, not owned, not revoked), for the daily check. */
  listBillingPlans(limit: number): Promise<EntitlementRow[]>;
  /** Moves a plan to another offer's tier and price (O10b); a statement for the atomic runner. */
  changePlanOfferStatement(id: string, patch: Pick<EntitlementRow, "offerId" | "title" | "includesBonus" | "priceCents">): Statement;
};

const offerCols = {
  id: offers.id,
  title: offers.title,
  description: offers.description,
  priceCents: offers.priceCents,
  billing: offers.billing,
  installmentCount: offers.installmentCount,
  scope: offers.scope,
  scopeIds: offers.scopeIds,
  includesBonus: offers.includesBonus,
  accessDays: offers.accessDays,
  isActive: offers.isActive,
  position: offers.position,
};

const paymentCols = {
  id: payments.id,
  userId: payments.userId,
  entitlementId: payments.entitlementId,
  amountCents: payments.amountCents,
  provider: payments.provider,
  providerPaymentId: payments.providerPaymentId,
  paidAt: payments.paidAt,
  refundedCents: payments.refundedCents,
};

const entitlementCols = {
  id: entitlements.id,
  userId: entitlements.userId,
  source: entitlements.source,
  offerId: entitlements.offerId,
  title: entitlements.title,
  scope: entitlements.scope,
  scopeIds: entitlements.scopeIds,
  billing: entitlements.billing,
  installmentCount: entitlements.installmentCount,
  installmentsPaid: entitlements.installmentsPaid,
  includesBonus: entitlements.includesBonus,
  paidThrough: entitlements.paidThrough,
  status: entitlements.status,
  priceCents: entitlements.priceCents,
  reason: entitlements.reason,
  grantedBy: entitlements.grantedBy,
  providerRef: entitlements.providerRef,
  finalNoticeSentAt: entitlements.finalNoticeSentAt,
  paymentFailedAt: entitlements.paymentFailedAt,
};

/** Stored ids come back as unknown JSON; anything that is not a list of strings reads as empty. */
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

const toOffer = (r: { [K in keyof typeof offerCols]: unknown }): OfferRow => ({ ...(r as OfferRow), scopeIds: ids(r.scopeIds) });
const toEntitlement = (r: { [K in keyof typeof entitlementCols]: unknown }): EntitlementRow => ({ ...(r as EntitlementRow), scopeIds: ids(r.scopeIds) });

export function createAccessRepo(db: Database): AccessRepo {
  const first = async <T>(operation: string, rows: Promise<T[]>): Promise<T | null> => withDbErrors(operation, async () => (await rows)[0] ?? null);

  return {
    listOffers: () => withDbErrors("access.listOffers", async () => (await db.select(offerCols).from(offers).orderBy(asc(offers.position))).map(toOffer)),
    findOffer: async (id) => {
      const row = await first("access.findOffer", db.select(offerCols).from(offers).where(eq(offers.id, id)).limit(1));
      return row ? toOffer(row) : null;
    },
    nextOfferPosition: () =>
      withDbErrors("access.nextOfferPosition", async () => {
        const top = (await db.select({ top: max(offers.position) }).from(offers))[0]?.top;
        return top === null || top === undefined ? 0 : Number(top) + 1;
      }),
    insertOfferStatement: (row) => db.insert(offers).values(row),
    updateOfferStatement: (id, patch) => db.update(offers).set({ ...patch, updatedAt: sql`now()` }).where(eq(offers.id, id)),
    deleteOfferStatement: (id) => db.delete(offers).where(eq(offers.id, id)),
    countEntitlementsForOffer: (offerId) =>
      withDbErrors("access.countEntitlementsForOffer", async () => Number((await db.select({ n: count() }).from(entitlements).where(eq(entitlements.offerId, offerId)))[0]?.n ?? 0)),

    listEntitlementsForUser: (userId) =>
      withDbErrors("access.listEntitlementsForUser", async () =>
        (await db.select(entitlementCols).from(entitlements).where(eq(entitlements.userId, userId)).orderBy(asc(entitlements.createdAt))).map(toEntitlement),
      ),
    findEntitlement: async (id) => {
      const row = await first("access.findEntitlement", db.select(entitlementCols).from(entitlements).where(eq(entitlements.id, id)).limit(1));
      return row ? toEntitlement(row) : null;
    },
    findEntitlementByProviderRef: async (providerRef) => {
      const row = await first("access.findEntitlementByProviderRef", db.select(entitlementCols).from(entitlements).where(eq(entitlements.providerRef, providerRef)).limit(1));
      return row ? toEntitlement(row) : null;
    },
    listEndedWithoutNotice: (endedBefore) =>
      withDbErrors("access.listEndedWithoutNotice", async () =>
        (
          await db
            .select(entitlementCols)
            .from(entitlements)
            .where(
              and(
                eq(entitlements.source, "purchase"),
                inArray(entitlements.billing, ["monthly", "installments"]),
                ne(entitlements.status, "revoked"),
                isNotNull(entitlements.paidThrough),
                lt(entitlements.paidThrough, endedBefore),
                isNull(entitlements.finalNoticeSentAt),
              ),
            )
            .limit(500)
        ).map(toEntitlement),
      ),
    insertEntitlementStatement: (row) => db.insert(entitlements).values(row),
    updateEntitlementStatement: (id, patch) => db.update(entitlements).set({ ...patch, updatedAt: sql`now()` }).where(eq(entitlements.id, id)),

    findPayment: (provider, providerPaymentId) =>
      first("access.findPayment", db.select(paymentCols).from(payments).where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId))).limit(1)),
    findPaymentById: (id) => first("access.findPaymentById", db.select(paymentCols).from(payments).where(eq(payments.id, id)).limit(1)),
    refundPaymentStatement: (id, refundedCents) => db.update(payments).set({ refundedCents }).where(eq(payments.id, id)),
    insertPaymentStatement: (row) => db.insert(payments).values(row),

    insertCheckoutSession: (row) => withDbErrors("access.insertCheckoutSession", async () => void (await db.insert(checkoutSessions).values(row))),
    findCheckoutSessionByToken: async (token) => {
      const row = await first(
        "access.findCheckoutSession",
        db
          .select({
            id: checkoutSessions.id,
            token: checkoutSessions.token,
            userId: checkoutSessions.userId,
            offerId: checkoutSessions.offerId,
            status: checkoutSessions.status,
            priceCents: checkoutSessions.priceCents,
            couponId: checkoutSessions.couponId,
          })
          .from(checkoutSessions)
          .where(eq(checkoutSessions.token, token))
          .limit(1),
      );
      return row ? (row as CheckoutSessionRow) : null;
    },
    completeCheckoutSessionStatement: (id, at) => db.update(checkoutSessions).set({ status: "completed", completedAt: at }).where(eq(checkoutSessions.id, id)),

    getAlertPrefs: (userId) =>
      withDbErrors("access.getAlertPrefs", async () => {
        const row = (
          await db
            .select({ dismissedForeverAt: accessAlertPrefs.dismissedForeverAt, snoozedUntil: accessAlertPrefs.snoozedUntil })
            .from(accessAlertPrefs)
            .where(eq(accessAlertPrefs.userId, userId))
            .limit(1)
        )[0];
        return row ?? { dismissedForeverAt: null, snoozedUntil: null };
      }),
    saveAlertPrefs: (userId, prefs) =>
      withDbErrors("access.saveAlertPrefs", async () => {
        await db
          .insert(accessAlertPrefs)
          .values({ userId, ...prefs })
          .onConflictDoUpdate({ target: accessAlertPrefs.userId, set: { ...prefs, updatedAt: sql`now()` } });
      }),

    findBillingCustomer: (userId, provider) =>
      withDbErrors("access.findBillingCustomer", async () => {
        const row = (
          await db
            .select({ id: billingCustomers.providerCustomerId })
            .from(billingCustomers)
            .where(and(eq(billingCustomers.userId, userId), eq(billingCustomers.provider, provider)))
            .limit(1)
        )[0];
        return row?.id ?? null;
      }),
    saveBillingCustomer: (userId, provider, providerCustomerId) =>
      withDbErrors("access.saveBillingCustomer", async () => {
        await db.insert(billingCustomers).values({ userId, provider, providerCustomerId }).onConflictDoNothing();
      }),
    listBillingPlans: (limit) =>
      withDbErrors("access.listBillingPlans", async () =>
        (
          await db
            .select(entitlementCols)
            .from(entitlements)
            .where(
              and(
                eq(entitlements.source, "purchase"),
                inArray(entitlements.billing, ["monthly", "installments"]),
                ne(entitlements.status, "revoked"),
                isNotNull(entitlements.paidThrough),
                isNotNull(entitlements.providerRef),
              ),
            )
            .orderBy(asc(entitlements.createdAt))
            .limit(limit)
        ).map(toEntitlement),
      ),
    changePlanOfferStatement: (id, patch) => db.update(entitlements).set({ ...patch, updatedAt: sql`now()` }).where(eq(entitlements.id, id)),
  };
}
