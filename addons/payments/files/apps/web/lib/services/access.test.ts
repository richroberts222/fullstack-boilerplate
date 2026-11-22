import { createOfferSchema, PAYMENTS_SETTING_DEFAULTS, startCheckoutSchema, updateOfferSchema, updatePaymentsSettingsSchema, type CreateOfferInput } from "@app-boilerplate/validation";
import { describe, expect, it } from "vitest";

import type { AccessRepo, AlertPrefs, CheckoutSessionRow, EntitlementRow, OfferRow, PaymentRow } from "../../db/access";
import type { ScopeCatalog } from "./scope-catalog";
import { DatabaseError } from "../../db/errors";
import type { AuditEvent } from "../../db/settings";
import { inAllowList } from "../auth/site-owner";
import type { AccessEndedNotice } from "../notices/ports";
import { createClosedPayments, createDevPayments, type CompletedCheckout, type PaymentEvent, type PaymentsPort, type ProviderPlan } from "../payments/ports";
import { ServiceError } from "./errors";
import { createAccessService } from "./access";
import { createPricingService } from "./pricing";
import { createFakePricingRepo } from "./testing/fake-pricing-repo";
import { accessState, addMonth, covers, DAY_MS } from "./access-rules";
import { createServiceContext } from "./context";
import { runService } from "./run";

// Access and grace period (/docs/features/access-and-checkout.md, /docs/features/grace-period.md).
// The fake repository keeps rows in memory; statements are functions run by a fake atomic runner that
// restores everything when one statement fails, like the real database transaction.

const C_GOD = "00000000-0000-4000-8000-0000000000c1";
const C_REV = "00000000-0000-4000-8000-0000000000c2";
const C_CREATE = "00000000-0000-4000-8000-0000000000c3";
const M_GOD1 = "00000000-0000-4000-8000-0000000000a1";
const M_CREATE1 = "00000000-0000-4000-8000-0000000000a3";

const scopes: ScopeCatalog = {
  knownIds: async (kind) => (kind === "groups" ? [C_GOD, C_REV, C_CREATE] : [M_GOD1, M_CREATE1]),
};

const T0 = new Date("2027-01-31T12:00:00Z");

function setup(opts: { payments?: PaymentsPort; grace?: number; snooze?: number; failNotice?: boolean; notAccepted?: string[]; trialDays?: number } = {}) {
  const db = {
    offers: new Map<string, OfferRow>(),
    entitlements: new Map<string, EntitlementRow>(),
    payments: [] as PaymentRow[],
    sessions: new Map<string, CheckoutSessionRow>(),
    prefs: new Map<string, AlertPrefs>(),
    audits: [] as AuditEvent[],
    billing: new Map<string, string>(),
  };
  const clock = { now: new Date(T0) };
  const notices: AccessEndedNotice[] = [];
  const settings = { gracePeriodDays: opts.grace ?? 30, reminderSnoozeDays: opts.snooze ?? 3 };
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const stmt = (fn: () => void) => fn as never;

  const repo: AccessRepo = {
    listOffers: async () => [...db.offers.values()].sort((a, b) => a.position - b.position),
    findOffer: async (oid) => db.offers.get(oid) ?? null,
    nextOfferPosition: async () => db.offers.size,
    insertOfferStatement: (row) => stmt(() => db.offers.set(row.id, { ...row })),
    updateOfferStatement: (oid, patch) => stmt(() => db.offers.set(oid, { ...db.offers.get(oid)!, ...patch })),
    deleteOfferStatement: (oid) => stmt(() => db.offers.delete(oid)),
    countEntitlementsForOffer: async (oid) => [...db.entitlements.values()].filter((e) => e.offerId === oid).length,
    listEntitlementsForUser: async (uid) => [...db.entitlements.values()].filter((e) => e.userId === uid).map((e) => ({ ...e })),
    findEntitlement: async (eid) => (db.entitlements.has(eid) ? { ...db.entitlements.get(eid)! } : null),
    findEntitlementByProviderRef: async (ref) => [...db.entitlements.values()].find((e) => e.providerRef === ref) ?? null,
    listEndedWithoutNotice: async (before) =>
      [...db.entitlements.values()].filter(
        (e) => e.source === "purchase" && e.billing !== "one_time" && e.status !== "revoked" && e.paidThrough !== null && e.paidThrough < before && e.finalNoticeSentAt === null,
      ),
    insertEntitlementStatement: (row) => stmt(() => db.entitlements.set(row.id, { ...row })),
    updateEntitlementStatement: (eid, patch) => stmt(() => db.entitlements.set(eid, { ...db.entitlements.get(eid)!, ...patch })),
    findPayment: async (provider, pid) => {
      const p = db.payments.find((x) => x.provider === provider && x.providerPaymentId === pid);
      return p ? { refundedCents: 0, ...p } : null;
    },
    findPaymentById: async (pid) => {
      const p = db.payments.find((x) => x.id === pid);
      return p ? { refundedCents: 0, ...p } : null;
    },
    refundPaymentStatement: (pid, refundedCents) =>
      stmt(() => {
        const p = db.payments.find((x) => x.id === pid)!;
        (p as PaymentRow & { refundedCents?: number }).refundedCents = refundedCents;
      }),
    insertPaymentStatement: (row) =>
      stmt(() => {
        if (db.payments.some((p) => p.provider === row.provider && p.providerPaymentId === row.providerPaymentId)) throw new DatabaseError("unique_violation", "payments.insert", null);
        db.payments.push({ ...row });
      }),
    insertCheckoutSession: async (row) => void db.sessions.set(row.token, { ...row }),
    findCheckoutSessionByToken: async (token) => (db.sessions.has(token) ? { ...db.sessions.get(token)! } : null),
    completeCheckoutSessionStatement: (sid) =>
      stmt(() => {
        for (const s of db.sessions.values()) if (s.id === sid) s.status = "completed";
      }),
    getAlertPrefs: async (uid) => db.prefs.get(uid) ?? { dismissedForeverAt: null, snoozedUntil: null },
    saveAlertPrefs: async (uid, prefs) => void db.prefs.set(uid, { ...prefs }),
    findBillingCustomer: async (uid, provider) => db.billing.get(`${uid}|${provider}`) ?? null,
    saveBillingCustomer: async (uid, provider, cid) => {
      if (!db.billing.has(`${uid}|${provider}`)) db.billing.set(`${uid}|${provider}`, cid);
    },
    listBillingPlans: async () =>
      [...db.entitlements.values()].filter((e) => e.source === "purchase" && e.billing !== "one_time" && e.status !== "revoked" && e.paidThrough !== null && e.providerRef !== null),
    changePlanOfferStatement: (eid, patch) => stmt(() => db.entitlements.set(eid, { ...db.entitlements.get(eid)!, ...patch })),
  };

  const fakePricing = createFakePricingRepo();
  const snapshot = () =>
    structuredClone({ offers: db.offers, entitlements: db.entitlements, payments: db.payments, sessions: db.sessions, audits: db.audits, pricing: { ...fakePricing.data } });
  const auditRepo = { insertStatement: (event: AuditEvent) => stmt(() => db.audits.push(event)) };
  const atomic = async (_op: string, statements: unknown) => {
    const before = snapshot();
    try {
      for (const s of statements as (() => void)[]) s();
    } catch (e) {
      const { pricing: p, ...rest } = before;
      Object.assign(db, rest);
      Object.assign(fakePricing.data, p);
      throw e;
    }
    return [];
  };
  const pricing = createPricingService({ repo: fakePricing.repo, audit: auditRepo, atomic: atomic as never, isSiteOwner: inAllowList(["user_owner"]), now: () => new Date(clock.now), newId: id });
  const svc = createAccessService({
    repo,
    scopes,
    audit: auditRepo,
    atomic: atomic as never,
    payments: opts.payments ?? createDevPayments(),
    pricing,
    notices: {
      accessEnded: async (notice) => {
        if (opts.failNotice) throw new Error("mail down");
        notices.push(notice);
      },
    },
    isSiteOwner: inAllowList(["user_owner"]),
    graceSettings: async () => settings,
    now: () => new Date(clock.now),
    newId: id,
    newToken: () => `token_${String(++n).padStart(20, "0")}`,
    hasAcceptedTerms: async (userId) => !(opts.notAccepted ?? []).includes(userId),
    memberEmail: async (userId) => `${userId}@example.com`,
    billingSettings: async () => ({ trialDays: opts.trialDays ?? 0 }),
  });
  const days = (d: number) => (clock.now = new Date(clock.now.getTime() + d * DAY_MS));
  return { svc, db, clock, days, notices, settings, pricing, pricingData: fakePricing.data };
}

const owner = createServiceContext("user_owner");
const member = createServiceContext("user_member");
const other = createServiceContext("user_other");

const offerInput = (over: Partial<CreateOfferInput> = {}): CreateOfferInput => ({
  title: "God teaching with Revelations",
  description: "",
  priceCents: 9900,
  billing: "one_time",
  installmentCount: 1,
  scope: "groups",
  scopeIds: [C_GOD, C_REV],
  includesBonus: false,
  accessDays: null,
  isActive: true,
  ...over,
});

/** Creates an offer as the owner, then buys it as `who` through the test checkout. */
async function buy(env: ReturnType<typeof setup>, over: Partial<CreateOfferInput> = {}, who = member) {
  const { id: offerId } = await env.svc.createOffer(owner, offerInput(over));
  const { redirectUrl } = await env.svc.startCheckout(who, { offerId });
  const token = decodeURIComponent(redirectUrl.split("/").pop()!);
  const { entitlementId } = await env.svc.completeDevCheckout(who, { token });
  return { offerId, token, entitlementId: entitlementId! };
}

const GOD_VIDEO = { partId: M_GOD1, groupId: C_GOD };
const CREATE_VIDEO = { partId: M_CREATE1, groupId: C_CREATE };

describe("access and checkout", () => {
  it("AC1: the pricing page lists only active offers, in order, with the tier, length and what they cover, and nothing internal", async () => {
    const { svc } = setup();
    await svc.createOffer(owner, offerInput({ title: "Bundle", includesBonus: true, accessDays: 365 }));
    await svc.createOffer(owner, offerInput({ title: "Hidden", isActive: false, priceCents: 0 }));
    const offers = await svc.getPublicOffers();
    expect(offers.map((o) => o.title)).toEqual(["Bundle"]);
    expect(offers[0]).toMatchObject({ includesBonus: true, accessDays: 365, scope: "groups", scopeIds: [C_GOD, C_REV] });
    expect(offers[0]).not.toHaveProperty("isActive");
    expect(offers[0]).not.toHaveProperty("position");
  });

  it("AC2: only the owner can create, edit or delete offers, and each change is audited with before and after", async () => {
    const { svc, db } = setup();
    expect(await runService(() => svc.createOffer(member, offerInput()))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await runService(() => svc.getOwnerOffers(member))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(db.offers.size).toBe(0);
    const { id } = await svc.createOffer(owner, offerInput());
    await svc.updateOffer(owner, { id, ...offerInput({ priceCents: 4900 }) });
    expect(await runService(() => svc.updateOffer(member, { id, ...offerInput({ priceCents: 1 }) }))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await svc.deleteOffer(owner, { id });
    expect(db.audits.map((a) => [a.action, a.actorUserId])).toEqual([
      ["offer.create", "user_owner"],
      ["offer.update", "user_owner"],
      ["offer.delete", "user_owner"],
    ]);
    expect(db.audits[1]).toMatchObject({ before: { priceCents: 9900 }, after: { priceCents: 4900 } });
  });

  it("AC3: an offer must make sense: plans need 2+ payments, scope ids match the scope, a sale needs a price, an edit sends every field", () => {
    expect(createOfferSchema.safeParse(offerInput()).success).toBe(true);
    expect(createOfferSchema.safeParse(offerInput({ billing: "installments", installmentCount: 1 })).success).toBe(false);
    expect(createOfferSchema.safeParse(offerInput({ scope: "everything" })).success).toBe(false);
    expect(createOfferSchema.safeParse(offerInput({ scope: "parts", scopeIds: [] })).success).toBe(false);
    expect(createOfferSchema.safeParse(offerInput({ scopeIds: [C_GOD, C_GOD] })).success).toBe(false);
    expect(createOfferSchema.safeParse(offerInput({ priceCents: 0 })).success).toBe(false);
    expect(createOfferSchema.safeParse(offerInput({ priceCents: 10.5 })).success).toBe(false);
    expect(updateOfferSchema.safeParse({ id: C_GOD, title: "Only a title" }).success).toBe(false);
  });

  it("AC3: an offer cannot unlock a group or part that does not exist", async () => {
    const { svc } = setup();
    expect(await runService(() => svc.createOffer(owner, offerInput({ scopeIds: ["00000000-0000-4000-8000-00000000dead"] })))).toMatchObject({
      ok: false,
      error: { code: "validation_failed", fieldErrors: { scopeIds: [expect.any(String)] } },
    });
    expect(await runService(() => svc.createOffer(owner, offerInput({ scope: "parts", scopeIds: [C_GOD] })))).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("AC4: an offer someone holds cannot be deleted, only turned off", async () => {
    const env = setup();
    const { offerId } = await buy(env);
    expect(await runService(() => env.svc.deleteOffer(owner, { id: offerId }))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(env.db.offers.has(offerId)).toBe(true);
  });

  it("AC5: checkout refuses an offer that is not for sale, and leaves nothing behind when purchases are closed", async () => {
    const closed = setup({ payments: createClosedPayments() });
    const { id } = await closed.svc.createOffer(owner, offerInput());
    expect(await runService(() => closed.svc.startCheckout(member, { offerId: id }))).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(closed.db.sessions.size).toBe(0);
    const env = setup();
    const { id: off } = await env.svc.createOffer(owner, offerInput({ isActive: false, priceCents: 0 }));
    expect(await runService(() => env.svc.startCheckout(member, { offerId: off }))).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("legal gate AC4: checkout is refused until the member accepts the Terms in force, and leaves no session behind", async () => {
    const env = setup({ notAccepted: ["user_member"] });
    const { id } = await env.svc.createOffer(owner, offerInput());
    expect(await runService(() => env.svc.startCheckout(member, { offerId: id }))).toMatchObject({ ok: false, error: { code: "policy_reacceptance_required" } });
    expect(env.db.sessions.size).toBe(0);
    // The same request succeeds for a member who has accepted.
    const ok = setup();
    const { id: same } = await ok.svc.createOffer(owner, offerInput());
    expect(await runService(() => ok.svc.startCheckout(member, { offerId: same }))).toMatchObject({ ok: true });
  });

  it("AC5: a member cannot buy what they already hold, or anything once they hold everything", async () => {
    const env = setup();
    const { offerId } = await buy(env);
    expect(await runService(() => env.svc.startCheckout(member, { offerId }))).toMatchObject({ ok: false, error: { code: "conflict" } });
    await env.svc.setLifetimeAccess(owner, { userId: "user_member", enabled: true });
    const { id: other } = await env.svc.createOffer(owner, offerInput({ title: "Creation", scopeIds: [C_CREATE] }));
    expect(await runService(() => env.svc.startCheckout(member, { offerId: other }))).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("AC6: completing the test checkout records the offer's price and grants access for good (one-time)", async () => {
    const env = setup();
    const { entitlementId } = await buy(env);
    expect(env.db.payments).toEqual([expect.objectContaining({ userId: "user_member", entitlementId, amountCents: 9900, provider: "dev" })]);
    expect(env.db.entitlements.get(entitlementId)).toMatchObject({ source: "purchase", paidThrough: null, status: "active", scope: "groups" });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    env.days(5000);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
  });

  it("AC6: completing twice, or racing a second completion, grants once", async () => {
    const env = setup();
    const { token } = await buy(env);
    expect(await env.svc.completeDevCheckout(member, { token })).toEqual({ entitlementId: null });
    // A racing second completion that read the session before it was marked complete hits the unique payment id.
    const session = [...env.db.sessions.values()][0];
    session.status = "open";
    expect(await runService(() => env.svc.completeDevCheckout(member, { token }))).toEqual({ ok: true, data: { entitlementId: null } });
    expect(env.db.entitlements.size).toBe(1);
    expect(env.db.payments).toHaveLength(1);
  });

  it("AC6: only the member who started a checkout can see or complete it, and the test checkout does not exist when purchases are closed", async () => {
    const env = setup();
    const { id } = await env.svc.createOffer(owner, offerInput());
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId: id });
    const token = decodeURIComponent(redirectUrl.split("/").pop()!);
    expect(await runService(() => env.svc.getDevCheckout(other, token))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await runService(() => env.svc.completeDevCheckout(other, { token }))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(env.db.entitlements.size).toBe(0);
    // With purchases closed, even a real open session of this very member cannot be completed.
    const closed = setup({ payments: createClosedPayments() });
    const { id: offerId } = await closed.svc.createOffer(owner, offerInput());
    closed.db.sessions.set(token, { id: "00000000-0000-4000-8000-00000000beef", token, userId: "user_member", offerId, status: "open", priceCents: null, couponId: null });
    expect(await runService(() => closed.svc.getDevCheckout(member, token))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await runService(() => closed.svc.completeDevCheckout(member, { token }))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(closed.db.entitlements.size).toBe(0);
  });

  it("AC7: editing an offer later never changes what someone already bought", async () => {
    const env = setup();
    const { offerId, entitlementId } = await buy(env);
    await env.svc.updateOffer(owner, { id: offerId, ...offerInput({ title: "Renamed", scopeIds: [C_CREATE] }) });
    expect(env.db.entitlements.get(entitlementId)).toMatchObject({ title: "God teaching with Revelations", scopeIds: [C_GOD, C_REV] });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    expect(await env.svc.canAccess("user_member", CREATE_VIDEO)).toBe(false);
  });

  it("AC8: a monthly plan is paid a month at a time; a repeated payment notice is recorded once", async () => {
    const env = setup();
    const { entitlementId } = await buy(env, { billing: "monthly", priceCents: 900, scope: "everything", scopeIds: [] });
    const e = env.db.entitlements.get(entitlementId)!;
    expect(e.paidThrough).toEqual(new Date("2027-02-28T12:00:00Z"));
    const pay = { provider: "dev", providerPaymentId: "pay_2", amountCents: 900, paidAt: new Date("2027-02-27T12:00:00Z") };
    expect(await env.svc.recordRenewal(e.providerRef!, pay)).toMatchObject({ recorded: true });
    expect(await env.svc.recordRenewal(e.providerRef!, pay)).toMatchObject({ recorded: false });
    expect(env.db.entitlements.get(entitlementId)!.paidThrough).toEqual(new Date("2027-03-28T12:00:00Z"));
    expect(env.db.payments).toHaveLength(2);
  });

  it("AC8: a payment plan is owned for good when the last payment arrives", async () => {
    const env = setup();
    const { entitlementId } = await buy(env, { billing: "installments", installmentCount: 3, priceCents: 5000, scope: "everything", scopeIds: [] });
    await env.svc.payNextDevPayment(member, entitlementId);
    expect(env.db.entitlements.get(entitlementId)).toMatchObject({ installmentsPaid: 2, paidThrough: expect.any(Date) });
    await env.svc.payNextDevPayment(member, entitlementId);
    expect(env.db.entitlements.get(entitlementId)).toMatchObject({ installmentsPaid: 3, paidThrough: null });
    expect(env.db.payments.map((p) => p.amountCents)).toEqual([5000, 5000, 5000]);
    env.days(5000);
    expect(await env.svc.canAccess("user_member", CREATE_VIDEO)).toBe(true);
    expect(await runService(() => env.svc.payNextDevPayment(other, entitlementId))).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("AC9: access covers exactly its scope: everything, listed groups, or listed parts", () => {
    expect(covers({ scope: "everything", scopeIds: [] }, CREATE_VIDEO)).toBe(true);
    expect(covers({ scope: "groups", scopeIds: [C_GOD] }, GOD_VIDEO)).toBe(true);
    expect(covers({ scope: "groups", scopeIds: [C_GOD] }, CREATE_VIDEO)).toBe(false);
    expect(covers({ scope: "parts", scopeIds: [M_GOD1] }, GOD_VIDEO)).toBe(true);
    expect(covers({ scope: "parts", scopeIds: [M_GOD1] }, { partId: "other", groupId: C_GOD })).toBe(false);
  });

  it("AC10: a member can cancel their own plan; access lasts to the paid date and the grace period, then ends", async () => {
    const env = setup();
    const { entitlementId } = await buy(env, { billing: "monthly", priceCents: 900, scope: "everything", scopeIds: [] });
    expect(await runService(() => env.svc.cancelPlan(other, entitlementId))).toMatchObject({ ok: false, error: { code: "not_found" } });
    await env.svc.cancelPlan(member, entitlementId);
    expect((await env.svc.getMyAccess(member))[0]).toMatchObject({ canceled: true, canCancel: false, state: "active" });
    env.days(28 + 29);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    env.days(2);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
  });

  it("AC10: a one-time purchase has nothing to cancel", async () => {
    const env = setup();
    const { entitlementId } = await buy(env);
    expect(await runService(() => env.svc.cancelPlan(member, entitlementId))).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("AC11: the free-lifetime checkbox grants everything for good, and unchecking revokes it; both audited, owner only", async () => {
    const { svc, db, days } = setup();
    expect(await runService(() => svc.setLifetimeAccess(member, { userId: "user_member", enabled: true }))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await svc.setLifetimeAccess(owner, { userId: "user_member", enabled: true })).toEqual({ changed: true });
    expect(await svc.setLifetimeAccess(owner, { userId: "user_member", enabled: true })).toEqual({ changed: false });
    days(10000);
    expect(await svc.canAccess("user_member", CREATE_VIDEO)).toBe(true);
    expect(await svc.setLifetimeAccess(owner, { userId: "user_member", enabled: false })).toEqual({ changed: true });
    expect(await svc.canAccess("user_member", CREATE_VIDEO)).toBe(false);
    expect(db.audits.map((a) => a.action)).toEqual(["access.lifetime_grant", "access.lifetime_revoke"]);
  });

  it("AC12: a scholarship unlocks what the owner chose through its end date, with the reason recorded", async () => {
    const { svc, db, days } = setup();
    const input = { userId: "user_member", scope: "groups" as const, scopeIds: [C_GOD], endsOn: "2027-02-10", includesBonus: false, reason: "Ministry partner" };
    expect(await runService(() => svc.grantScholarship(member, input))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const { id } = await svc.grantScholarship(owner, input);
    expect(await svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    expect(await svc.canAccess("user_member", CREATE_VIDEO)).toBe(false);
    days(10.4); // 2027-02-10 21:36 UTC: still the end date
    expect(await svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    days(1); // past the end date, and a scholarship has no grace period
    expect(await svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    expect(db.audits[0]).toMatchObject({ action: "access.scholarship_grant", subject: id, after: { reason: "Ministry partner" } });
  });

  it("AC12: a scholarship ending in the past is refused; revoking a grant is audited; a purchase is not revoked here", async () => {
    const env = setup();
    expect(
      await runService(() => env.svc.grantScholarship(owner, { userId: "user_member", scope: "everything", scopeIds: [], endsOn: "2027-01-01", includesBonus: false, reason: "x" })),
    ).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const { id } = await env.svc.grantScholarship(owner, { userId: "user_member", scope: "everything", scopeIds: [], endsOn: null, includesBonus: false, reason: "Gift" });
    await env.svc.revokeGrant(owner, { entitlementId: id, reason: "Ended early" });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    expect(env.db.audits.at(-1)).toMatchObject({ action: "access.grant_revoke", after: { status: "revoked", reason: "Ended early" } });
    const { entitlementId } = await buy(env);
    expect(await runService(() => env.svc.revokeGrant(owner, { entitlementId, reason: "no" }))).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("AC13: a month later is the same day next month, or that month's last day", () => {
    expect(addMonth(new Date("2027-01-31T12:00:00Z"))).toEqual(new Date("2027-02-28T12:00:00Z"));
    expect(addMonth(new Date("2028-01-31T12:00:00Z"))).toEqual(new Date("2028-02-29T12:00:00Z"));
    expect(addMonth(new Date("2027-03-15T08:30:00Z"))).toEqual(new Date("2027-04-15T08:30:00Z"));
    expect(addMonth(new Date("2027-12-31T00:00:00Z"))).toEqual(new Date("2028-01-31T00:00:00Z"));
  });
});

describe("grace period", () => {
  /** A monthly plan bought at T0 and canceled, so it is paid through 2027-02-28 12:00 UTC. */
  async function lapsed(opts: Parameters<typeof setup>[0] = {}) {
    const env = setup(opts);
    const bought = await buy(env, { billing: "monthly", priceCents: 900, scope: "everything", scopeIds: [] });
    await env.svc.cancelPlan(member, bought.entitlementId);
    return { ...env, ...bought };
  }

  it("AC1: after the paid date, full access continues for the grace days, then ends; one-time and granted access have no grace period", async () => {
    const paid = { source: "purchase" as const, billing: "monthly" as const, status: "active" as const, paidThrough: new Date("2027-02-28T12:00:00Z") };
    expect(accessState(paid, new Date("2027-02-28T11:59:59Z"), 30)).toBe("active");
    expect(accessState(paid, new Date("2027-02-28T12:00:00Z"), 30)).toBe("grace");
    expect(accessState(paid, new Date("2027-03-30T11:59:59Z"), 30)).toBe("grace");
    expect(accessState(paid, new Date("2027-03-30T12:00:00Z"), 30)).toBe("ended");
    expect(accessState({ ...paid, billing: "installments" }, new Date("2027-03-01T00:00:00Z"), 30)).toBe("grace");
    expect(accessState({ ...paid, source: "scholarship", billing: "one_time" }, new Date("2027-02-28T12:00:00Z"), 30)).toBe("ended");
    expect(accessState({ ...paid, status: "revoked" }, new Date("2027-01-01T00:00:00Z"), 30)).toBe("ended");
  });

  it("AC1: the grace days come from the owner's setting (default 30), and a change applies at once", async () => {
    expect(PAYMENTS_SETTING_DEFAULTS.gracePeriodDays).toBe(30);
    const env = await lapsed();
    env.days(28 + 10);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    env.settings.gracePeriodDays = 5;
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
  });

  it("AC2: the banner shows only during the grace period, with when access ends", async () => {
    const env = await lapsed();
    expect(await env.svc.getGraceAlert(member)).toBeNull();
    env.days(29);
    expect(await env.svc.getGraceAlert(member)).toMatchObject({ entitlementId: env.entitlementId, graceEndsAt: new Date("2027-03-30T12:00:00Z") });
    expect(await env.svc.getGraceAlert(other)).toBeNull();
    env.days(31);
    expect(await env.svc.getGraceAlert(member)).toBeNull();
  });

  it("AC3: 'Remind me in a few days' hides it for the snooze setting, then it returns", async () => {
    const env = await lapsed({ snooze: 3 });
    env.days(29);
    await env.svc.answerGraceAlert(member, { action: "snooze" });
    expect(await env.svc.getGraceAlert(member)).toBeNull();
    env.days(2.9);
    expect(await env.svc.getGraceAlert(member)).toBeNull();
    env.days(0.2);
    expect(await env.svc.getGraceAlert(member)).not.toBeNull();
  });

  it("AC4: 'Don't show this again' hides it for good, kept on the account (not the browser)", async () => {
    const env = await lapsed();
    env.days(29);
    await env.svc.answerGraceAlert(member, { action: "dismiss_forever" });
    expect(env.db.prefs.get("user_member")?.dismissedForeverAt).toEqual(expect.any(Date));
    env.days(10);
    expect(await env.svc.getGraceAlert(member)).toBeNull();
    // A later snooze cannot bring it back.
    await env.svc.answerGraceAlert(member, { action: "snooze" });
    env.days(5);
    expect(await env.svc.getGraceAlert(member)).toBeNull();
  });

  it("AC5: 'Continue here' buys the same offer again at its full price, and the banner goes away", async () => {
    const env = await lapsed();
    env.days(29);
    const alert = await env.svc.getGraceAlert(member);
    expect(alert?.continueOfferId).toBe(env.offerId);
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId: env.offerId });
    await env.svc.completeDevCheckout(member, { token: decodeURIComponent(redirectUrl.split("/").pop()!) });
    // No retention discount: the second payment is the offer's own price.
    expect(env.db.payments.map((p) => p.amountCents)).toEqual([900, 900]);
    expect(await env.svc.getGraceAlert(member)).toBeNull();
  });

  it("AC5: when the offer is no longer for sale, the banner has no 'Continue here' target", async () => {
    const env = await lapsed();
    await env.svc.updateOffer(owner, { id: env.offerId, ...offerInput({ billing: "monthly", priceCents: 900, scope: "everything", scopeIds: [], isActive: false }) });
    env.days(29);
    expect((await env.svc.getGraceAlert(member))?.continueOfferId).toBeNull();
  });

  it("AC6: when access ends, one quiet final notice goes to everyone, including those who dismissed the banner, and never twice", async () => {
    const env = await lapsed();
    env.days(29);
    await env.svc.answerGraceAlert(member, { action: "dismiss_forever" });
    expect(await env.svc.sendAccessEndedNotices()).toEqual({ sent: 0, skipped: 0 });
    env.days(31);
    expect(await env.svc.sendAccessEndedNotices()).toEqual({ sent: 1, skipped: 0 });
    expect(env.notices).toEqual([{ userId: "user_member", entitlementId: env.entitlementId, title: "God teaching with Revelations" }]);
    expect(await env.svc.sendAccessEndedNotices()).toEqual({ sent: 0, skipped: 0 });
    expect(env.notices).toHaveLength(1);
  });

  it("AC6: no notice for a member who already bought the same offer again, and a failed send is not retried", async () => {
    const env = await lapsed();
    env.days(29);
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId: env.offerId });
    await env.svc.completeDevCheckout(member, { token: decodeURIComponent(redirectUrl.split("/").pop()!) });
    env.days(30.5); // the old plan's grace has ended; the new one is paid through 2027-04-01
    expect(await env.svc.sendAccessEndedNotices()).toEqual({ sent: 0, skipped: 1 });
    const failing = await lapsed({ failNotice: true });
    failing.days(61);
    expect(await failing.svc.sendAccessEndedNotices()).toEqual({ sent: 0, skipped: 1 });
    expect(await failing.svc.sendAccessEndedNotices()).toEqual({ sent: 0, skipped: 0 });
  });

  it("AC7: the grace and snooze settings take whole days in range; empty or text is refused, never read as zero", () => {
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: "45" }).data).toEqual({ gracePeriodDays: 45 });
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: 0 }).success).toBe(true);
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: "" }).success).toBe(false);
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: "ten" }).success).toBe(false);
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: "2.5" }).success).toBe(false);
    expect(updatePaymentsSettingsSchema.safeParse({ gracePeriodDays: 366 }).success).toBe(false);
    expect(updatePaymentsSettingsSchema.safeParse({ reminderSnoozeDays: 0 }).success).toBe(false);
    expect(updatePaymentsSettingsSchema.safeParse({ reminderSnoozeDays: "3" }).success).toBe(true);
  });

  it("AC8: the member's account page shows the plan in its grace period with the date access ends", async () => {
    const env = await lapsed();
    env.days(29);
    expect(await env.svc.getMyAccess(member)).toEqual([
      expect.objectContaining({ title: "God teaching with Revelations", state: "grace", graceEndsAt: new Date("2027-03-30T12:00:00Z"), canCancel: false }),
    ]);
  });

  it("O6 bonus tier: a basic holder gets the base content but not the bonus; an upgraded holder gets both", async () => {
    const basic = setup();
    await buy(basic, { includesBonus: false });
    expect(await basic.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    expect(await basic.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(false);
    const upgraded = setup();
    await buy(upgraded, { includesBonus: true });
    expect(await upgraded.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(true);
    // The bonus follows the same scope as the sessions: not for a group the offer does not cover.
    expect(await upgraded.svc.canAccessBonus("user_member", CREATE_VIDEO)).toBe(false);
    expect(await upgraded.svc.canAccessBonus("user_other", GOD_VIDEO)).toBe(false);
  });

  it("O6 bonus tier: the bonus lapses and enters the grace period exactly like the sessions", async () => {
    const env = setup({ grace: 30 });
    await buy(env, { includesBonus: true, billing: "monthly" });
    env.days(31 + 10); // past the paid month, inside the grace period
    expect(await env.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(true);
    env.days(30); // past the grace period
    expect(await env.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(false);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
  });

  it("O6 bonus tier: the lifetime gift includes the bonus; a scholarship includes it only when the owner says so", async () => {
    const env = setup();
    await env.svc.grantScholarship(owner, { userId: "user_member", scope: "groups", scopeIds: [C_GOD], endsOn: null, includesBonus: false, reason: "Help" });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    expect(await env.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(false);
    await env.svc.grantScholarship(owner, { userId: "user_other", scope: "groups", scopeIds: [C_GOD], endsOn: null, includesBonus: true, reason: "Help" });
    expect(await env.svc.canAccessBonus("user_other", GOD_VIDEO)).toBe(true);
    await env.svc.setLifetimeAccess(owner, { userId: "user_gift", enabled: true });
    expect(await env.svc.canAccessBonus("user_gift", CREATE_VIDEO)).toBe(true);
  });

  it("O6 one year: a one-time purchase with 365 days of access ends after a year, with no grace period", async () => {
    const env = setup({ grace: 30 });
    const { entitlementId } = await buy(env, { accessDays: 365 });
    const start = env.clock.now.getTime();
    expect(env.db.entitlements.get(entitlementId)?.paidThrough?.getTime()).toBe(start + 365 * DAY_MS);
    env.days(364);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    env.days(1.01);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
  });

  it("O6 one year: a plan never stores an access length, so it can only end by its payments", async () => {
    const { svc } = setup();
    const { id } = await svc.createOffer(owner, offerInput({ billing: "monthly", accessDays: 365 }));
    expect((await svc.getOwnerOffers(owner)).find((o) => o.id === id)?.accessDays).toBeNull();
  });

  // ----- O7: coupons and scholarship amounts ------------------------------------------------------

  const coupon = (over: Partial<Parameters<ReturnType<typeof setup>["pricing"]["createCoupon"]>[1]> = {}) => ({
    code: "SAVE10",
    kind: "percent" as const,
    value: 10,
    offerIds: [] as string[],
    endsOn: null,
    maxUses: null,
    isActive: true,
    ...over,
  });
  const discount = (over: Partial<Parameters<ReturnType<typeof setup>["pricing"]["grantDiscount"]>[1]> = {}) => ({
    userId: "user_member",
    kind: "amount" as const,
    value: 2000,
    offerIds: [] as string[],
    endsOn: null,
    reason: "Ministry partner",
    ...over,
  });

  it("O7: a percent coupon rounds to the nearest cent; a fixed one takes off cents; both are charged as quoted", async () => {
    const env = setup();
    const { id: offerId } = await env.svc.createOffer(owner, offerInput({ priceCents: 9999 }));
    await env.pricing.createCoupon(owner, coupon({ code: "SAVE15", value: 15 }));
    await env.pricing.createCoupon(owner, coupon({ code: "FIVE", kind: "amount", value: 500 }));
    // 15% of $99.99 is 1499.85 cents: 1500 off.
    expect(await env.svc.quote(null, { offerId, couponCode: "SAVE15" })).toMatchObject({ listCents: 9999, couponCents: 1500, finalCents: 8499, couponCode: "SAVE15" });
    expect((await env.svc.quote(null, { offerId, couponCode: "FIVE" })).finalCents).toBe(9499);
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId, couponCode: "SAVE15" });
    const token = decodeURIComponent(redirectUrl.split("/").pop()!);
    expect((await env.svc.getDevCheckout(member, token)).offer.priceCents).toBe(8499);
    const { entitlementId } = await env.svc.completeDevCheckout(member, { token });
    expect(env.db.payments.at(-1)?.amountCents).toBe(8499);
    expect(env.db.entitlements.get(entitlementId!)?.priceCents).toBe(8499);
    expect([...env.pricingData.coupons.values()].find((c) => c.code === "SAVE15")?.usedCount).toBe(1);
  });

  it("O7: the scholarship amount comes first (the largest that applies), then the coupon, and the total never goes below zero", async () => {
    const env = setup();
    const { id: offerId } = await env.svc.createOffer(owner, offerInput({ priceCents: 10000 }));
    await env.pricing.grantDiscount(owner, discount({ kind: "amount", value: 2000 }));
    await env.pricing.grantDiscount(owner, discount({ kind: "percent", value: 30 }));
    await env.pricing.createCoupon(owner, coupon({ code: "HALF", value: 50 }));
    await env.pricing.createCoupon(owner, coupon({ code: "BIG", kind: "amount", value: 900000 }));
    // 30% off $100 beats $20 off; then half of the $70 left.
    expect(await env.svc.quote(member, { offerId, couponCode: "HALF" })).toMatchObject({ scholarshipCents: 3000, couponCents: 3500, finalCents: 3500 });
    // A visitor and another member get no scholarship amount.
    expect((await env.svc.quote(null, { offerId, couponCode: undefined })).finalCents).toBe(10000);
    expect((await env.svc.quote(other, { offerId, couponCode: undefined })).finalCents).toBe(10000);
    expect((await env.svc.quote(member, { offerId, couponCode: "BIG" })).finalCents).toBe(0);
  });

  it("O7: an ended, used-up, turned-off or other-offer code is refused with one message, and checkout leaves nothing behind", async () => {
    const env = setup();
    const { id: offerId } = await env.svc.createOffer(owner, offerInput());
    const { id: otherOffer } = await env.svc.createOffer(owner, offerInput({ title: "Other" }));
    await env.pricing.createCoupon(owner, coupon({ code: "SOON", endsOn: "2027-02-01" }));
    await env.pricing.createCoupon(owner, coupon({ code: "ONCE", maxUses: 1 }));
    await env.pricing.createCoupon(owner, coupon({ code: "OFF", isActive: false }));
    await env.pricing.createCoupon(owner, coupon({ code: "ONLYOTHER", offerIds: [otherOffer] }));
    // Each works before the condition that refuses it, so the refusal is the rule, not a typo.
    expect((await env.svc.quote(member, { offerId, couponCode: "SOON" })).couponCents).toBeGreaterThan(0);
    await buy(env, {}, other);
    expect((await env.svc.quote(member, { offerId: otherOffer, couponCode: "ONLYOTHER" })).couponCents).toBeGreaterThan(0);
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId, couponCode: "ONCE" });
    await env.svc.completeDevCheckout(member, { token: decodeURIComponent(redirectUrl.split("/").pop()!) });
    env.days(2); // past SOON's last day (Feb 1)
    const sessionsBefore = env.db.sessions.size;
    for (const code of ["SOON", "ONCE", "OFF", "ONLYOTHER", "NOSUCH"]) {
      const r = await runService(() => env.svc.startCheckout(other, { offerId, couponCode: code }));
      expect(r).toMatchObject({ ok: false, error: { code: "validation_failed", message: "This code does not work for this." } });
    }
    expect(env.db.sessions.size).toBe(sessionsBefore);
  });

  it("O7: a free result on a one-time offer grants at once with a zero payment; a free plan is refused", async () => {
    const env = setup();
    const { id: once } = await env.svc.createOffer(owner, offerInput());
    const { id: monthly } = await env.svc.createOffer(owner, offerInput({ title: "Monthly", billing: "monthly" }));
    await env.pricing.createCoupon(owner, coupon({ code: "FREE", value: 100 }));
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    expect(await env.svc.startCheckout(member, { offerId: once, couponCode: "FREE" })).toEqual({ redirectUrl: "/dashboard" });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    expect(env.db.payments.at(-1)).toMatchObject({ amountCents: 0, provider: "free" });
    expect(await runService(() => env.svc.startCheckout(other, { offerId: monthly, couponCode: "FREE" }))).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await env.svc.canAccess("user_other", GOD_VIDEO)).toBe(false);
  });

  it("O7: later payments of a plan charge the agreed price, not the list price", async () => {
    const env = setup();
    const { id: offerId } = await env.svc.createOffer(owner, offerInput({ billing: "installments", installmentCount: 3, priceCents: 10000 }));
    await env.pricing.grantDiscount(owner, discount({ kind: "percent", value: 25 }));
    const { redirectUrl } = await env.svc.startCheckout(member, { offerId, couponCode: undefined });
    const { entitlementId } = await env.svc.completeDevCheckout(member, { token: decodeURIComponent(redirectUrl.split("/").pop()!) });
    await env.svc.payNextDevPayment(member, entitlementId!);
    expect(env.db.payments.map((p) => p.amountCents)).toEqual([7500, 7500]);
  });

  it("O7: the client cannot send a price: the checkout and quote schemas drop it", () => {
    const parsed = startCheckoutSchema.parse({ offerId: C_GOD, couponCode: " save10 ", priceCents: 1 });
    expect(parsed).toEqual({ offerId: C_GOD, couponCode: "SAVE10" });
    expect(startCheckoutSchema.parse({ offerId: C_GOD, couponCode: "" })).toEqual({ offerId: C_GOD });
  });

  it("O7: only the owner manages coupons and scholarship amounts; each change is audited; a code is unique; past end dates are refused", async () => {
    const env = setup();
    expect(await runService(() => env.pricing.createCoupon(member, coupon()))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await runService(() => env.pricing.grantDiscount(member, discount()))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await runService(() => env.pricing.listCoupons(member))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const { id } = await env.pricing.createCoupon(owner, coupon());
    expect(await runService(() => env.pricing.createCoupon(owner, coupon()))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await runService(() => env.pricing.createCoupon(owner, coupon({ code: "OLD", endsOn: "2027-01-01" })))).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await env.pricing.updateCoupon(owner, { id, kind: "percent", value: 20, offerIds: [], endsOn: null, maxUses: 5, isActive: false });
    const { id: did } = await env.pricing.grantDiscount(owner, discount());
    await env.pricing.revokeDiscount(owner, { id: did, reason: "Ended" });
    expect(env.db.audits.map((a) => a.action)).toEqual(["coupon.create", "coupon.update", "discount.grant", "discount.revoke"]);
    const { id: offerId } = await env.svc.createOffer(owner, offerInput({ priceCents: 10000 }));
    expect((await env.svc.quote(member, { offerId, couponCode: undefined })).scholarshipCents).toBe(0);
  });

  // ----- O2: a provider's hosted checkout and notifications ---------------------------------------

  /** A provider port that answers like Stripe would, from a script the test controls. */
  function fakeProvider() {
    const state = {
      completed: new Map<string, CompletedCheckout>(),
      events: [] as PaymentEvent[],
      canceled: [] as [string, string][],
      started: [] as { token: string; priceCents: number; customerId: string | null; trialDays: number }[],
      customers: [] as { userId: string; email: string | null; idempotencyKey: string }[],
      previewCents: 0,
      changes: [] as { ref: string; priceCents: number; title: string; increase: boolean }[],
      changeApplies: true,
      plans: new Map<string, ProviderPlan | "error">(),
      refunds: [] as [string, number, string][],
      resumed: [] as string[],
      failRefund: false,
    };
    const port: PaymentsPort = {
      provider: "stripe",
      startCheckout: async ({ token, offer, customerId, trialDays }) => {
        state.started.push({ token, priceCents: offer.priceCents, customerId: customerId ?? null, trialDays: trialDays ?? 0 });
        return { redirectUrl: `https://checkout.example/${token}` };
      },
      cancel: async (ref, when) => void state.canceled.push([ref, when]),
      getCompletedCheckout: async (id) => state.completed.get(id) ?? null,
      readEvent: async (_body, signature) => {
        if (signature !== "good") throw new ServiceError("forbidden", "Bad signature");
        return state.events.shift() ?? { kind: "ignored" };
      },
      refund: async (id, amount, key) => {
        if (state.failRefund) throw new Error("Stripe down");
        state.refunds.push([id, amount, key]);
      },
      resume: async (ref) => void state.resumed.push(ref),
      deleteCustomer: async () => {}, // used only by account deletion (privacy.test.ts)
      createCustomer: async (input) => {
        state.customers.push(input);
        return `cus_${state.customers.length}`;
      },
      billingPortal: async (cid) => ({ url: `https://billing.example/${cid}` }),
      previewPlanChange: async () => ({ amountDueNowCents: state.previewCents }),
      changePlan: async (ref, { priceCents, title, increase }) => {
        state.changes.push({ ref, priceCents, title, increase });
        return { applied: state.changeApplies };
      },
      getPlan: async (ref) => {
        const plan = state.plans.get(ref);
        if (plan === "error") throw new Error("Stripe down");
        return plan ?? null;
      },
    };
    return { port, state };
  }

  async function startProvider(env: ReturnType<typeof setup>, provider: ReturnType<typeof fakeProvider>, over: Partial<CreateOfferInput> = {}, who = member) {
    const { id: offerId } = await env.svc.createOffer(owner, offerInput(over));
    await env.svc.startCheckout(who, { offerId });
    const { token, priceCents } = provider.state.started.at(-1)!;
    return { offerId, token, priceCents };
  }

  const paid = (token: string, amountCents: number, providerRef: string | null = null, id = "pi_1"): CompletedCheckout => ({
    token,
    payment: { provider: "stripe", providerPaymentId: id, amountCents, paidAt: new Date(T0) },
    providerRef,
  });

  it("AC24: the return page grants only what the provider confirms, only to the buyer, and a repeat or the notification counts once", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider);
    expect(await env.svc.completeProviderCheckout(member, "cs_1")).toEqual({ status: "pending" });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    provider.state.completed.set("cs_1", paid(token, priceCents));
    expect(await runService(() => env.svc.completeProviderCheckout(other, "cs_1"))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await env.svc.completeProviderCheckout(member, "cs_1")).toEqual({ status: "granted" });
    expect(await env.svc.completeProviderCheckout(member, "cs_1")).toEqual({ status: "already" });
    provider.state.events.push({ kind: "checkout_completed", providerSessionId: "cs_1" });
    expect(await env.svc.handlePaymentEvent("{}", "good")).toEqual({ handled: true });
    expect(env.db.entitlements.size).toBe(1);
    expect(env.db.payments).toEqual([expect.objectContaining({ provider: "stripe", providerPaymentId: "pi_1", amountCents: 9900 })]);
  });

  it("AC24: a payment below the quoted price grants nothing", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider);
    provider.state.completed.set("cs_1", paid(token, priceCents - 1));
    expect(await runService(() => env.svc.completeProviderCheckout(member, "cs_1"))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
  });

  it("AC23: a notification with a bad signature changes nothing", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider);
    provider.state.completed.set("cs_1", paid(token, priceCents));
    provider.state.events.push({ kind: "checkout_completed", providerSessionId: "cs_1" });
    expect(await runService(() => env.svc.handlePaymentEvent("{}", "forged"))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(env.db.entitlements.size).toBe(0);
  });

  it("AC25: renewals extend a plan once each; a renewal for an unknown plan is not_found so the provider retries; an unpaid checkout notice asks for a retry", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider, { billing: "monthly" });
    provider.state.events.push({ kind: "renewal", providerRef: "sub_9", payment: { provider: "stripe", providerPaymentId: "in_2", amountCents: priceCents, paidAt: new Date(T0) } });
    expect(await runService(() => env.svc.handlePaymentEvent("{}", "good"))).toMatchObject({ ok: false, error: { code: "not_found" } });
    provider.state.events.push({ kind: "checkout_completed", providerSessionId: "cs_1" });
    expect(await runService(() => env.svc.handlePaymentEvent("{}", "good"))).toMatchObject({ ok: false, error: { code: "unavailable" } });
    provider.state.completed.set("cs_1", paid(token, priceCents, "sub_9", "in_1"));
    await env.svc.completeProviderCheckout(member, "cs_1");
    const renewal = { kind: "renewal" as const, providerRef: "sub_9", payment: { provider: "stripe", providerPaymentId: "in_2", amountCents: priceCents, paidAt: new Date("2027-02-28T12:00:00Z") } };
    provider.state.events.push(renewal, renewal);
    await env.svc.handlePaymentEvent("{}", "good");
    await env.svc.handlePaymentEvent("{}", "good");
    expect(env.db.payments.map((p) => p.providerPaymentId)).toEqual(["in_1", "in_2"]);
    expect([...env.db.entitlements.values()][0].paidThrough).toEqual(new Date("2027-03-28T12:00:00Z"));
    expect(provider.state.canceled).toEqual([]);
  });

  it("AC26: the last payment of a payment plan makes it owned and stops the provider's charges; a member's own cancel stops at the period end", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider, { billing: "installments", installmentCount: 2 });
    provider.state.completed.set("cs_1", paid(token, priceCents, "sub_9", "in_1"));
    await env.svc.completeProviderCheckout(member, "cs_1");
    provider.state.events.push({ kind: "renewal", providerRef: "sub_9", payment: { provider: "stripe", providerPaymentId: "in_2", amountCents: priceCents, paidAt: new Date(T0) } });
    await env.svc.handlePaymentEvent("{}", "good");
    expect([...env.db.entitlements.values()][0].paidThrough).toBeNull();
    expect(provider.state.canceled).toEqual([["sub_9", "now"]]);
    const monthly = setup({ payments: provider.port });
    const m = await startProvider(monthly, provider, { billing: "monthly" });
    provider.state.completed.set("cs_2", paid(m.token, m.priceCents, "sub_10", "in_10"));
    await monthly.svc.completeProviderCheckout(member, "cs_2");
    await monthly.svc.cancelPlan(member, [...monthly.db.entitlements.values()][0].id);
    expect(provider.state.canceled.at(-1)).toEqual(["sub_10", "period_end"]);
  });

  // ----- O10: billing like the industry standard -------------------------------------------------

  /** A member on a monthly plan paid through the provider: subscription sub_9, first payment in_1. */
  async function monthlyPlan(over: Partial<CreateOfferInput> = {}) {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    const { token, priceCents } = await startProvider(env, provider, { billing: "monthly", ...over });
    provider.state.completed.set("cs_1", paid(token, priceCents, "sub_9", "in_1"));
    await env.svc.completeProviderCheckout(member, "cs_1");
    const plan = () => [...env.db.entitlements.values()][0]!;
    const payment = () => env.db.payments[0] as PaymentRow & { refundedCents?: number };
    return { provider, env, plan, payment, priceCents };
  }
  const event = (env: ReturnType<typeof setup>, provider: ReturnType<typeof fakeProvider>, e: PaymentEvent) => {
    provider.state.events.push(e);
    return runService(() => env.svc.handlePaymentEvent("{}", "good"));
  };

  it("O10 failed payment: marks the plan past due without ending access, once; the next payment clears it", async () => {
    const { provider, env, plan, priceCents } = await monthlyPlan();
    expect((await env.svc.getMyAccess(member))[0]!.paymentFailed).toBe(false);
    await event(env, provider, { kind: "payment_failed", providerRef: "sub_9" });
    const first = plan().paymentFailedAt;
    expect(first).toBeInstanceOf(Date);
    expect((await env.svc.getMyAccess(member))[0]!.paymentFailed).toBe(true);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    env.days(1);
    await event(env, provider, { kind: "payment_failed", providerRef: "sub_9" });
    expect(plan().paymentFailedAt).toEqual(first);
    await event(env, provider, { kind: "renewal", providerRef: "sub_9", payment: { provider: "stripe", providerPaymentId: "in_2", amountCents: priceCents, paidAt: new Date(T0) } });
    expect(plan().paymentFailedAt).toBeNull();
    expect((await env.svc.getMyAccess(member))[0]!.paymentFailed).toBe(false);
  });

  it("O10 in step with the provider: stopped there means canceled here (access to the paid date), undone means active; unknown plans are ignored", async () => {
    const { provider, env, plan } = await monthlyPlan();
    expect(await event(env, provider, { kind: "plan_changed", providerRef: "sub_unknown", cancelAtPeriodEnd: true })).toEqual({ ok: true, data: { handled: false } });
    await event(env, provider, { kind: "plan_changed", providerRef: "sub_9", cancelAtPeriodEnd: true });
    expect(plan().status).toBe("canceled");
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    await event(env, provider, { kind: "plan_changed", providerRef: "sub_9", cancelAtPeriodEnd: false });
    expect(plan().status).toBe("active");
    await event(env, provider, { kind: "plan_ended", providerRef: "sub_9" });
    expect(plan().status).toBe("canceled");
    expect(plan().paidThrough).not.toBeNull();
  });

  it("O10 resume: a member restarts their stopped plan before its paid date, through the provider; not after it", async () => {
    const { provider, env, plan } = await monthlyPlan();
    await env.svc.cancelPlan(member, plan().id);
    expect((await env.svc.getMyAccess(member))[0]!.canResume).toBe(true);
    expect(await runService(() => env.svc.resumePlan(other, plan().id))).toMatchObject({ ok: false });
    await env.svc.resumePlan(member, plan().id);
    expect(plan().status).toBe("active");
    expect(provider.state.resumed).toEqual(["sub_9"]);
    await env.svc.cancelPlan(member, plan().id);
    env.days(40);
    expect(await runService(() => env.svc.resumePlan(member, plan().id))).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("O10 owner refund: a partial refund keeps access; the rest ends it and stops the plan; the key names the exact refund; audited; never more than paid", async () => {
    const { provider, env, plan, payment, priceCents } = await monthlyPlan();
    expect(await runService(() => env.svc.refundPayment(member, { paymentId: payment().id, amountCents: null, reason: "x" }))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await env.svc.refundPayment(owner, { paymentId: payment().id, amountCents: 1000, reason: "goodwill" });
    expect(provider.state.refunds).toEqual([["in_1", 1000, `refund_${payment().id}_0_1000`]]);
    expect(payment().refundedCents).toBe(1000);
    expect(plan().status).toBe("active");
    expect(await runService(() => env.svc.refundPayment(owner, { paymentId: payment().id, amountCents: priceCents, reason: "too much" }))).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const result = await env.svc.refundPayment(owner, { paymentId: payment().id, amountCents: null, reason: "asked" });
    expect(result).toEqual({ refundedCents: priceCents, accessEnded: true });
    expect(plan().status).toBe("revoked");
    expect(provider.state.canceled).toEqual([["sub_9", "now"]]);
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    expect(env.db.audits.filter((a) => a.action === "payment.refund")).toHaveLength(2);
    // The provider's own notice of the same refund changes nothing more.
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_1"], refundedCents: priceCents });
    expect(env.db.audits.filter((a) => a.action === "payment.refund")).toHaveLength(2);
  });

  it("O10 owner refund: if the provider refuses, nothing is recorded and access stays", async () => {
    const { provider, env, plan, payment } = await monthlyPlan();
    provider.state.failRefund = true;
    expect((await runService(() => env.svc.refundPayment(owner, { paymentId: payment().id, amountCents: null, reason: "x" }))).ok).toBe(false);
    expect(payment().refundedCents ?? 0).toBe(0);
    expect(plan().status).toBe("active");
  });

  it("O10 refund made in the provider's dashboard: a full refund ends the access it bought; a partial one does not; an unknown payment is retried", async () => {
    const { provider, env, plan, priceCents } = await monthlyPlan();
    expect(await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_404"], refundedCents: 100 })).toMatchObject({ ok: false, error: { code: "not_found" } });
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_1"], refundedCents: 100 });
    expect(plan().status).toBe("active");
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["pi_x", "in_1"], refundedCents: priceCents });
    expect(plan().status).toBe("revoked");
    expect(provider.state.canceled).toEqual([["sub_9", "now"]]);
  });

  it("O10 refund totals: an older, smaller notice arriving late never lowers the total, and the total never exceeds what was paid", async () => {
    const { provider, env, payment, priceCents } = await monthlyPlan();
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_1"], refundedCents: 300 });
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_1"], refundedCents: 100 });
    expect(payment().refundedCents).toBe(300);
    await event(env, provider, { kind: "refunded", providerPaymentIds: ["in_1"], refundedCents: priceCents + 999 });
    expect(payment().refundedCents).toBe(priceCents);
  });

  it("O10 dispute: a chargeback ends the access it bought at once and stops the plan, with a provider audit entry", async () => {
    const { provider, env, plan } = await monthlyPlan();
    await event(env, provider, { kind: "disputed", providerPaymentIds: ["in_1"] });
    expect(plan().status).toBe("revoked");
    expect(plan().reason).toBe("Disputed with the bank");
    expect(provider.state.canceled).toEqual([["sub_9", "now"]]);
    expect(env.db.audits.find((a) => a.action === "payment.dispute")?.actorUserId).toBe("system:payments");
  });

  it("O10 owner cancels for a member: at the period end keeps access to the paid date; now ends it; audited; owner only", async () => {
    const a = await monthlyPlan();
    expect(await runService(() => a.env.svc.ownerCancelPlan(member, { entitlementId: a.plan().id, when: "now", reason: "x" }))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await a.env.svc.ownerCancelPlan(owner, { entitlementId: a.plan().id, when: "period_end", reason: "asked by email" });
    expect(a.plan().status).toBe("canceled");
    expect(a.provider.state.canceled).toEqual([["sub_9", "period_end"]]);
    expect(await a.env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    const b = await monthlyPlan();
    await b.env.svc.ownerCancelPlan(owner, { entitlementId: b.plan().id, when: "now", reason: "abuse" });
    expect(b.plan().status).toBe("revoked");
    expect(await b.env.svc.canAccess("user_member", GOD_VIDEO)).toBe(false);
    expect(b.env.db.audits.filter((x) => x.action === "access.owner_cancel")).toHaveLength(1);
  });

  // ----- O10b: billing, second half ---------------------------------------------------------------

  it("O10b customer: one provider record per member, made with their email on the first checkout and reused; none with the test checkout", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    await startProvider(env, provider);
    await startProvider(env, provider, { title: "Second", scopeIds: [C_CREATE] });
    await startProvider(env, provider, {}, other);
    expect(provider.state.customers).toEqual([
      { userId: "user_member", email: "user_member@example.com", idempotencyKey: "customer_user_member" },
      { userId: "user_other", email: "user_other@example.com", idempotencyKey: "customer_user_other" },
    ]);
    expect(provider.state.started.map((s) => s.customerId)).toEqual(["cus_1", "cus_1", "cus_2"]);
    const dev = setup();
    await buy(dev);
    expect(dev.db.billing.size).toBe(0);
  });

  it("O10b manage billing: opens the provider's page for the member's own record; refused before any checkout; offered only once there is one", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port });
    expect(await env.svc.canManageBilling(member)).toBe(false);
    expect(await runService(() => env.svc.openBillingPortal(member))).toMatchObject({ ok: false, error: { code: "conflict" } });
    await startProvider(env, provider);
    expect(await env.svc.canManageBilling(member)).toBe(true);
    expect(await env.svc.openBillingPortal(member)).toEqual({ url: "https://billing.example/cus_1" });
    expect(await env.svc.canManageBilling(other)).toBe(false);
  });

  /** A member on basic monthly (9900) with an upgraded monthly (14900) for the same groups on sale. */
  async function tierSetup() {
    const m = await monthlyPlan();
    const { id: upgradedId } = await m.env.svc.createOffer(owner, offerInput({ title: "Upgraded, monthly", billing: "monthly", includesBonus: true, priceCents: 14900, scopeIds: [C_REV, C_GOD] }));
    return { ...m, upgradedId };
  }

  it("O10b upgrade: offered on the plan; the server's price; the provider's prorated amount shown; bonus unlocks only when the provider confirms; audited", async () => {
    const { provider, env, plan, upgradedId } = await tierSetup();
    expect((await env.svc.getMyAccess(member))[0]!.tierChange).toEqual({ offerId: upgradedId, title: "Upgraded, monthly", upgrade: true });
    provider.state.previewCents = 2500;
    expect(await env.svc.previewTierChange(member, { entitlementId: plan().id, offerId: upgradedId })).toEqual({ offerId: upgradedId, title: "Upgraded, monthly", upgrade: true, newMonthlyCents: 14900, amountDueNowCents: 2500 });
    provider.state.changeApplies = false;
    expect(await env.svc.changeTier(member, { entitlementId: plan().id, offerId: upgradedId })).toEqual({ status: "payment_needed" });
    expect(plan().includesBonus).toBe(false);
    expect(await env.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(false);
    provider.state.changeApplies = true;
    expect(await env.svc.changeTier(member, { entitlementId: plan().id, offerId: upgradedId })).toEqual({ status: "changed" });
    expect(provider.state.changes.at(-1)).toEqual({ ref: "sub_9", priceCents: 14900, title: "Upgraded, monthly", increase: true });
    expect(plan()).toMatchObject({ includesBonus: true, offerId: upgradedId, priceCents: 14900, title: "Upgraded, monthly" });
    expect(await env.svc.canAccessBonus("user_member", GOD_VIDEO)).toBe(true);
    expect(env.db.audits.filter((a) => a.action === "access.tier_change")).toEqual([expect.objectContaining({ actorUserId: "user_member", subject: plan().id })]);
  });

  it("O10b downgrade: back to basic is credited, not charged now, and the scholarship amount applies to the new price", async () => {
    const { provider, env, plan, upgradedId } = await tierSetup();
    const offerId = plan().offerId!; // basic
    await env.svc.changeTier(member, { entitlementId: plan().id, offerId: upgradedId });
    await env.pricing.grantDiscount(owner, { userId: "user_member", kind: "amount", value: 1000, offerIds: [], endsOn: null, reason: "help" });
    provider.state.previewCents = 9999; // never asked about for a decrease
    expect(await env.svc.previewTierChange(member, { entitlementId: plan().id, offerId })).toMatchObject({ upgrade: false, newMonthlyCents: 8900, amountDueNowCents: 0 });
    await env.svc.changeTier(member, { entitlementId: plan().id, offerId });
    expect(provider.state.changes.at(-1)).toMatchObject({ priceCents: 8900, increase: false });
    expect(plan()).toMatchObject({ includesBonus: false, priceCents: 8900 });
    expect(upgradedId).not.toBe(offerId);
  });

  it("O10b tier change refused: someone else's plan, a plan in its grace period, a canceled plan, an offer that is not the other tier, a one-time purchase", async () => {
    const { env, plan, upgradedId } = await tierSetup();
    const input = { entitlementId: plan().id, offerId: upgradedId };
    expect(await runService(() => env.svc.changeTier(other, input))).toMatchObject({ ok: false, error: { code: "not_found" } });
    const { id: elsewhere } = await env.svc.createOffer(owner, offerInput({ title: "Other group", billing: "monthly", includesBonus: true, scopeIds: [C_CREATE] }));
    expect(await runService(() => env.svc.changeTier(member, { ...input, offerId: elsewhere }))).toMatchObject({ ok: false, error: { code: "conflict" } });
    const { id: yearly } = await env.svc.createOffer(owner, offerInput({ title: "Upgraded, one year", includesBonus: true, accessDays: 365 }));
    expect(await runService(() => env.svc.changeTier(member, { ...input, offerId: yearly }))).toMatchObject({ ok: false, error: { code: "conflict" } });
    await env.svc.cancelPlan(member, plan().id);
    expect(await runService(() => env.svc.changeTier(member, input))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect((await env.svc.getMyAccess(member))[0]!.tierChange).toBeNull();
    await env.svc.resumePlan(member, plan().id);
    env.days(40);
    expect(await runService(() => env.svc.changeTier(member, input))).toMatchObject({ ok: false, error: { code: "conflict" } });
    const once = setup();
    const bought = await buy(once);
    const { id: up } = await once.svc.createOffer(owner, offerInput({ includesBonus: true }));
    expect(await runService(() => once.svc.changeTier(member, { entitlementId: bought.entitlementId, offerId: up }))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(env.db.audits.some((a) => a.action === "access.tier_change")).toBe(false);
  });

  it("O10b trial: a first monthly plan gets the trial days and access until the trial ends with nothing paid; later purchases and other ways to pay get none", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port, trialDays: 14 });
    const { token } = await startProvider(env, provider, { billing: "monthly" });
    expect(provider.state.started.at(-1)!.trialDays).toBe(14);
    const trialEnd = new Date(T0.getTime() + 14 * DAY_MS);
    provider.state.completed.set("cs_1", { ...paid(token, 0, "sub_9", "in_0"), trialEndsAt: trialEnd });
    expect(await env.svc.completeProviderCheckout(member, "cs_1")).toEqual({ status: "granted" });
    const e = [...env.db.entitlements.values()][0]!;
    expect(e).toMatchObject({ paidThrough: trialEnd, installmentsPaid: 0 });
    expect(await env.svc.canAccess("user_member", GOD_VIDEO)).toBe(true);
    await startProvider(env, provider, { billing: "monthly", title: "Second", scopeIds: [C_CREATE] });
    expect(provider.state.started.at(-1)!.trialDays).toBe(0);
    const fresh = setup({ payments: provider.port, trialDays: 14 });
    await startProvider(fresh, provider, { billing: "installments", installmentCount: 3 }, other);
    expect(provider.state.started.at(-1)!.trialDays).toBe(0);
  });

  it("O10b trial: a trial on a payment plan or a one-time purchase, or one longer than the setting allows, grants nothing", async () => {
    const provider = fakeProvider();
    const env = setup({ payments: provider.port, trialDays: 14 });
    const plan = await startProvider(env, provider, { billing: "installments", installmentCount: 3 });
    provider.state.completed.set("cs_1", { ...paid(plan.token, 0, "sub_8", "in_8"), trialEndsAt: new Date(T0.getTime() + DAY_MS) });
    expect(await runService(() => env.svc.completeProviderCheckout(member, "cs_1"))).toMatchObject({ ok: false, error: { code: "conflict" } });
    const once = await startProvider(env, provider, { title: "Once", scopeIds: [C_REV] });
    provider.state.completed.set("cs_3", { ...paid(once.token, 0, null, "pi_0"), trialEndsAt: new Date(T0.getTime() + DAY_MS) });
    expect(await runService(() => env.svc.completeProviderCheckout(member, "cs_3"))).toMatchObject({ ok: false, error: { code: "conflict" } });
    const monthly = await startProvider(env, provider, { billing: "monthly", title: "M", scopeIds: [C_CREATE] });
    provider.state.completed.set("cs_2", { ...paid(monthly.token, 0, "sub_9", "in_0"), trialEndsAt: new Date(T0.getTime() + 400 * DAY_MS) });
    expect(await runService(() => env.svc.completeProviderCheckout(member, "cs_2"))).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(env.db.entitlements.size).toBe(0);
  });

  it("O10b daily check: reports each difference with the provider, changes nothing, and counts plans it could not check", async () => {
    const { provider, env, plan } = await monthlyPlan();
    const report = () => env.svc.reconcileBilling();
    provider.state.plans.set("sub_9", { status: "active", cancelAtPeriodEnd: false, unitAmountCents: 9900 });
    expect(await report()).toEqual({ checked: 1, skipped: 0, failed: 0, differences: [] });
    provider.state.plans.set("sub_9", { status: "canceled", cancelAtPeriodEnd: false, unitAmountCents: 4900 });
    expect((await report()).differences.map((d) => d.problem)).toEqual(["Ended at the payment provider, still active here", "Price differs: 4900 cents there, 9900 cents here"]);
    provider.state.plans.set("sub_9", { status: "active", cancelAtPeriodEnd: true, unitAmountCents: 9900 });
    expect((await report()).differences.map((d) => d.problem)).toEqual(["Set to stop at the payment provider, active here"]);
    provider.state.plans.set("sub_9", { status: "past_due", cancelAtPeriodEnd: false, unitAmountCents: 9900 });
    expect((await report()).differences.map((d) => d.problem)).toEqual(["Past due at the payment provider, not marked here"]);
    await env.svc.cancelPlan(member, plan().id);
    provider.state.plans.set("sub_9", { status: "active", cancelAtPeriodEnd: false, unitAmountCents: 9900 });
    expect(await report()).toMatchObject({ differences: [{ entitlementId: plan().id, providerRef: "sub_9", problem: "Stopped here, still billing at the payment provider" }] });
    expect(plan().status).toBe("canceled");
    provider.state.plans.set("sub_9", "error");
    expect(await report()).toEqual({ checked: 0, skipped: 0, failed: 1, differences: [] });
    provider.state.plans.delete("sub_9");
    expect(await report()).toEqual({ checked: 0, skipped: 1, failed: 0, differences: [] });
  });

  it("O4: a member who has not accepted the Terms in force cannot change tier or restart a plan, since both move money", async () => {
    const provider = fakeProvider();
    const notAccepted: string[] = [];
    const env = setup({ payments: provider.port, notAccepted });
    const { token, priceCents } = await startProvider(env, provider, { billing: "monthly" });
    provider.state.completed.set("cs_1", paid(token, priceCents, "sub_9", "in_1"));
    await env.svc.completeProviderCheckout(member, "cs_1");
    const planId = [...env.db.entitlements.values()][0]!.id;
    const { id: upgradedId } = await env.svc.createOffer(owner, offerInput({ title: "Upgraded, monthly", billing: "monthly", includesBonus: true, priceCents: 14900 }));
    await env.svc.cancelPlan(member, planId);
    // A newer Terms version is out and this member has not accepted it yet.
    notAccepted.push("user_member");
    expect(await runService(() => env.svc.resumePlan(member, planId))).toMatchObject({ ok: false, error: { code: "policy_reacceptance_required" } });
    expect(provider.state.resumed).toEqual([]);
    notAccepted.length = 0;
    await env.svc.resumePlan(member, planId);
    notAccepted.push("user_member");
    expect(await runService(() => env.svc.changeTier(member, { entitlementId: planId, offerId: upgradedId }))).toMatchObject({ ok: false, error: { code: "policy_reacceptance_required" } });
    expect(await runService(() => env.svc.previewTierChange(member, { entitlementId: planId, offerId: upgradedId }))).toMatchObject({ ok: false, error: { code: "policy_reacceptance_required" } });
    expect(provider.state.changes).toEqual([]);
    notAccepted.length = 0;
    expect(await env.svc.changeTier(member, { entitlementId: planId, offerId: upgradedId })).toEqual({ status: "changed" });
  });
});
