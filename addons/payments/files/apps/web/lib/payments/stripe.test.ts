import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ServiceError } from "../services/errors";
import { createStripePayments, STRIPE_API_VERSION, toForm, verifySignature } from "./stripe";

// Stripe adapter (/docs/features/access-and-checkout.md AC23 to AC26). No network: a fake fetch records
// each request and answers like Stripe.

const SECRET = "whsec_" + "test".repeat(8);
const NOW = new Date("2027-03-01T12:00:00Z");
const sign = (body: string, t = Math.floor(NOW.getTime() / 1000), secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

function fakeStripe(answer: (method: string, url: string, body: URLSearchParams | null) => { status?: number; json: unknown }) {
  const calls: { method: string; url: string; body: URLSearchParams | null; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? new URLSearchParams(init.body) : null;
    calls.push({ method: String(init.method), url, body, headers: init.headers as Record<string, string> });
    const { status = 200, json } = answer(String(init.method), url, body);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof globalThis.fetch;
  const port = createStripePayments({ secretKey: "sk_test_abc", webhookSecret: SECRET, siteUrl: "https://example.test", fetch, now: () => NOW });
  return { port, calls };
}

describe("Stripe signature", () => {
  const body = JSON.stringify({ type: "invoice.paid" });

  it("AC23: a correctly signed, fresh notification verifies", () => {
    expect(verifySignature(body, sign(body), SECRET, NOW)).toBe(true);
  });

  it("AC23: a forged, altered, stale or unsigned notification is refused, and an empty secret refuses everything", () => {
    expect(verifySignature(body, sign(body, undefined, "whsec_other"), SECRET, NOW)).toBe(false);
    expect(verifySignature(body + " ", sign(body), SECRET, NOW)).toBe(false);
    expect(verifySignature(body, sign(body, Math.floor(NOW.getTime() / 1000) - 301), SECRET, NOW)).toBe(false);
    expect(verifySignature(body, null, SECRET, NOW)).toBe(false);
    expect(verifySignature(body, "t=1,v1=zz", SECRET, NOW)).toBe(false);
    expect(verifySignature(body, sign(body), "", NOW)).toBe(false);
    // O12: with no secret set, a notification signed with an empty key is still refused (anyone could make one).
    expect(verifySignature(body, sign(body, undefined, ""), "", NOW)).toBe(false);
  });

  it("AC23: readEvent throws forbidden on a bad signature, before reading the body", async () => {
    const { port } = fakeStripe(() => ({ json: {} }));
    await expect(port.readEvent("not json", "t=1,v1=00")).rejects.toMatchObject({ code: "forbidden" });
    await expect(port.readEvent("not json", "t=1,v1=00")).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("Stripe checkout", () => {
  it("AC24: a one-time offer opens a payment checkout for the computed price; a plan opens a monthly subscription", async () => {
    const { port, calls } = fakeStripe(() => ({ json: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } }));
    const once = await port.startCheckout({ token: "tok_123456789012345", offer: { id: "o", title: "Basic, paid in full", priceCents: 26910, billing: "one_time", installmentCount: 1 } });
    expect(once.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const b = calls[0].body!;
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/checkout/sessions" });
    expect(calls[0].headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(b.get("mode")).toBe("payment");
    expect(b.get("line_items[0][price_data][unit_amount]")).toBe("26910");
    expect(b.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(b.get("client_reference_id")).toBe("tok_123456789012345");
    expect(b.get("line_items[0][price_data][recurring][interval]")).toBeNull();
    expect(b.get("success_url")).toBe("https://example.test/checkout/stripe/return?session_id={CHECKOUT_SESSION_ID}");
    await port.startCheckout({ token: "tok_123456789012345", offer: { id: "o", title: "Plan", priceCents: 10900, billing: "installments", installmentCount: 3 } });
    expect(calls[1].body!.get("mode")).toBe("subscription");
    expect(calls[1].body!.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(calls[1].body!.get("subscription_data[metadata][token]")).toBe("tok_123456789012345");
  });

  it("AC24: a checkout is reported paid only when Stripe says so, with Stripe's amount and ids", async () => {
    let answer: unknown = { id: "cs_test_1", client_reference_id: "tok_1", payment_status: "unpaid", amount_total: 26910, payment_intent: "pi_1", created: 1803902400 };
    const { port } = fakeStripe(() => ({ json: answer }));
    expect(await port.getCompletedCheckout("cs_test_1")).toBeNull();
    answer = { ...(answer as object), payment_status: "paid" };
    expect(await port.getCompletedCheckout("cs_test_1")).toEqual({
      token: "tok_1",
      payment: { provider: "stripe", providerPaymentId: "pi_1", amountCents: 26910, paidAt: new Date(1803902400 * 1000) },
      providerRef: null,
      trialEndsAt: null,
    });
    answer = { ...(answer as object), subscription: "sub_9", invoice: "in_1", payment_intent: null };
    expect(await port.getCompletedCheckout("cs_test_1")).toMatchObject({ providerRef: "sub_9", payment: { providerPaymentId: "in_1" } });
    // Something that is not a checkout session id is never sent to Stripe.
    expect(await port.getCompletedCheckout("../../charges")).toBeNull();
  });

  it("AC25: a later invoice is a renewal; the plan's first invoice and other events are ignored", async () => {
    const { port } = fakeStripe(() => ({ json: {} }));
    const event = (object: object, type = "invoice.paid") => JSON.stringify({ type, data: { object } });
    const renewal = event({ id: "in_2", billing_reason: "subscription_cycle", subscription: "sub_9", amount_paid: 10900, status_transitions: { paid_at: 1806580800 } });
    expect(await port.readEvent(renewal, sign(renewal))).toEqual({
      kind: "renewal",
      providerRef: "sub_9",
      payment: { provider: "stripe", providerPaymentId: "in_2", amountCents: 10900, paidAt: new Date(1806580800 * 1000) },
    });
    const first = event({ id: "in_1", billing_reason: "subscription_create", subscription: "sub_9", amount_paid: 10900 });
    expect(await port.readEvent(first, sign(first))).toEqual({ kind: "ignored" });
    const done = event({ id: "cs_test_1" }, "checkout.session.completed");
    expect(await port.readEvent(done, sign(done))).toEqual({ kind: "checkout_completed", providerSessionId: "cs_test_1" });
    const other = event({ id: "ch_1" }, "charge.refunded");
    expect(await port.readEvent(other, sign(other))).toEqual({ kind: "ignored" });
  });

  it("AC26: a member's cancel stops at the period end; finishing a payment plan stops it now; a non-Stripe reference is left alone", async () => {
    const { port, calls } = fakeStripe(() => ({ json: { id: "sub_9" } }));
    await port.cancel("sub_9", "period_end");
    await port.cancel("sub_9", "now");
    await port.cancel("dev_123", "now");
    expect(calls.map((c) => [c.method, c.url, c.body?.get("cancel_at_period_end") ?? null])).toEqual([
      ["POST", "https://api.stripe.com/v1/subscriptions/sub_9", "true"],
      ["DELETE", "https://api.stripe.com/v1/subscriptions/sub_9", null],
    ]);
  });

  it("AC11: deleting a member removes their Stripe customer; one already gone counts as done; other failures stop", async () => {
    const ok = fakeStripe(() => ({ json: { id: "cus_1", deleted: true } }));
    await ok.port.deleteCustomer("cus_1");
    await ok.port.deleteCustomer("dev_1"); // not a Stripe customer: left alone
    expect(ok.calls.map((c) => [c.method, c.url])).toEqual([["DELETE", "https://api.stripe.com/v1/customers/cus_1"]]);
    const gone = fakeStripe(() => ({ status: 404, json: { error: { type: "invalid_request_error" } } }));
    await expect(gone.port.deleteCustomer("cus_1")).resolves.toBeUndefined();
    const down = fakeStripe(() => ({ status: 500, json: { error: { type: "api_error" } } }));
    await expect(down.port.deleteCustomer("cus_1")).rejects.toThrow();
  });

  it("toForm writes Stripe's nested form keys", () => {
    expect(toForm({ a: { b: { 0: { c: 1 } } }, d: "x", e: undefined }).toString()).toBe("a%5Bb%5D%5B0%5D%5Bc%5D=1&d=x");
  });
});

describe("Stripe billing (O10)", () => {
  const signed = async (port: ReturnType<typeof fakeStripe>["port"], event: unknown) => {
    const body = JSON.stringify(event);
    return port.readEvent(body, sign(body));
  };

  it("O10 idempotency: every write carries a key (the checkout's from its token); a network failure is retried once with the same key; reads carry none", async () => {
    let fail = true;
    const calls: { method: string; key: string | undefined }[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), key: (init.headers as Record<string, string>)["Idempotency-Key"] });
      if (fail) {
        fail = false;
        throw new TypeError("network down");
      }
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/x" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const port = createStripePayments({ secretKey: "sk_test_abc", webhookSecret: SECRET, siteUrl: "https://example.test", fetch, now: () => NOW });
    await port.startCheckout({ token: "tok_123456789012345", offer: { id: "o", title: "T", priceCents: 100, billing: "one_time", installmentCount: 1 } });
    expect(calls).toEqual([
      { method: "POST", key: "checkout_tok_123456789012345" },
      { method: "POST", key: "checkout_tok_123456789012345" },
    ]);
    await port.cancel("sub_1", "now");
    expect(calls.at(-1)!.key).toMatch(/^[0-9a-f-]{36}$/);
    await port.getCompletedCheckout("cs_1");
    expect(calls.at(-1)).toEqual({ method: "GET", key: undefined });
  });

  it("O10 refund: a plan's payment is refunded through its invoice's payment intent, with the caller's key and amount", async () => {
    const { port, calls } = fakeStripe((method, url) => ({ json: url.includes("/invoices/") ? { payment_intent: "pi_77" } : { id: "re_1" } }));
    await port.refund("in_5", 1500, "refund_p1_0_1500");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.stripe.com/v1/invoices/in_5", "POST https://api.stripe.com/v1/refunds"]);
    expect(calls[1]!.body!.get("payment_intent")).toBe("pi_77");
    expect(calls[1]!.body!.get("amount")).toBe("1500");
    expect(calls[1]!.headers["Idempotency-Key"]).toBe("refund_p1_0_1500");
    await port.refund("pi_9", 100, "k");
    expect(calls.at(-1)!.body!.get("payment_intent")).toBe("pi_9");
    await expect(port.refund("dev_x", 100, "k")).rejects.toMatchObject({ code: "conflict" });
  });

  it("O10 resume undoes the period-end stop", async () => {
    const { port, calls } = fakeStripe(() => ({ json: {} }));
    await port.resume("sub_3");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/subscriptions/sub_3" });
    expect(calls[0]!.body!.get("cancel_at_period_end")).toBe("false");
  });

  it("O10 events: failed payment, plan stopped or undone, plan ended, refund total, and a dispute traced through its charge", async () => {
    const { port, calls } = fakeStripe(() => ({ json: { invoice: "in_8", payment_intent: "pi_8" } }));
    expect(await signed(port, { type: "invoice.payment_failed", data: { object: { subscription: "sub_1" } } })).toEqual({ kind: "payment_failed", providerRef: "sub_1" });
    expect(await signed(port, { type: "customer.subscription.updated", data: { object: { id: "sub_1", cancel_at_period_end: true } } })).toEqual({ kind: "plan_changed", providerRef: "sub_1", cancelAtPeriodEnd: true });
    expect(await signed(port, { type: "customer.subscription.updated", data: { object: { id: "sub_1", cancel_at_period_end: false } } })).toEqual({ kind: "plan_changed", providerRef: "sub_1", cancelAtPeriodEnd: false });
    expect(await signed(port, { type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } })).toEqual({ kind: "plan_ended", providerRef: "sub_1" });
    expect(await signed(port, { type: "charge.refunded", data: { object: { amount_refunded: 500, invoice: "in_2", payment_intent: "pi_2" } } })).toEqual({ kind: "refunded", providerPaymentIds: ["in_2", "pi_2"], refundedCents: 500 });
    expect(await signed(port, { type: "charge.dispute.created", data: { object: { charge: "ch_8", payment_intent: "pi_8" } } })).toEqual({ kind: "disputed", providerPaymentIds: ["in_8", "pi_8"] });
    expect(calls.at(-1)).toMatchObject({ method: "GET", url: "https://api.stripe.com/v1/charges/ch_8" });
  });
});

describe("Stripe billing, second half (O10b)", () => {
  /** A subscription with one item (si_1, product prod_old, $19.00 a month). */
  const sub = { id: "sub_9", status: "active", cancel_at_period_end: false, items: { data: [{ id: "si_1", price: { product: "prod_old", unit_amount: 1900 } }] } };

  it("O10b customer: made once per member with their email and id, under the caller's key; reused in checkout; a trial only on a monthly plan", async () => {
    const { port, calls } = fakeStripe((_m, url) => ({ json: url.endsWith("/customers") ? { id: "cus_1" } : { url: "https://checkout.stripe.com/x" } }));
    expect(await port.createCustomer({ userId: "user_a", email: "a@example.com", idempotencyKey: "customer_user_a" })).toBe("cus_1");
    expect(calls[0]!.body!.get("email")).toBe("a@example.com");
    expect(calls[0]!.body!.get("metadata[userId]")).toBe("user_a");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("customer_user_a");
    await port.startCheckout({ token: "tok_1", offer: { id: "o", title: "Monthly", priceCents: 1900, billing: "monthly", installmentCount: 1 }, customerId: "cus_1", trialDays: 14 });
    expect(calls[1]!.body!.get("customer")).toBe("cus_1");
    expect(calls[1]!.body!.get("subscription_data[trial_period_days]")).toBe("14");
    await port.startCheckout({ token: "tok_2", offer: { id: "o", title: "Plan", priceCents: 1900, billing: "installments", installmentCount: 3 }, customerId: "cus_1", trialDays: 14 });
    expect(calls[2]!.body!.get("subscription_data[trial_period_days]")).toBeNull();
    await port.startCheckout({ token: "tok_3", offer: { id: "o", title: "Once", priceCents: 1900, billing: "one_time", installmentCount: 1 }, customerId: "cus_1" });
    expect(calls[3]!.body!.get("invoice_creation[enabled]")).toBe("true");
  });

  it("O10b trial: a checkout with nothing paid yet and a trial end is confirmed with a zero payment and the trial's end; without a trial it is not", async () => {
    let answer: Record<string, unknown> = { client_reference_id: "tok_1", payment_status: "no_payment_required", amount_total: 0, subscription: { id: "sub_9", trial_end: 1804507200 }, invoice: "in_0", created: 1803902400 };
    const { port, calls } = fakeStripe(() => ({ json: answer }));
    expect(await port.getCompletedCheckout("cs_test_1")).toMatchObject({ providerRef: "sub_9", trialEndsAt: new Date(1804507200 * 1000), payment: { providerPaymentId: "in_0", amountCents: 0 } });
    expect(calls[0]!.url).toContain("expand%5B0%5D=subscription");
    answer = { ...answer, subscription: { id: "sub_9", trial_end: null }, amount_total: 1900 };
    expect(await port.getCompletedCheckout("cs_test_1")).toBeNull();
  });

  it("O10b manage billing: a portal session for the customer that returns to the dashboard; a bad id is never sent", async () => {
    const { port, calls } = fakeStripe(() => ({ json: { url: "https://billing.stripe.com/p/session_1" } }));
    expect(await port.billingPortal("cus_1")).toEqual({ url: "https://billing.stripe.com/p/session_1" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/billing_portal/sessions" });
    expect(calls[0]!.body!.get("return_url")).toBe("https://example.test/dashboard");
    await expect(port.billingPortal("../x")).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toHaveLength(1);
  });

  it("O10b preview: Stripe's upcoming invoice for the new price, now; only its proration lines count", async () => {
    const { port, calls } = fakeStripe((_m, url) => ({
      json: url.includes("invoices/upcoming") ? { lines: { data: [{ proration: true, amount: -950 }, { proration: true, amount: 1450 }, { proration: false, amount: 2900 }] } } : sub,
    }));
    expect(await port.previewPlanChange("sub_9", 2900)).toEqual({ amountDueNowCents: 500 });
    const q = new URL(calls[1]!.url).searchParams;
    expect(q.get("subscription_items[0][id]")).toBe("si_1");
    expect(q.get("subscription_items[0][price_data][unit_amount]")).toBe("2900");
    expect(q.get("subscription_proration_behavior")).toBe("always_invoice");
    expect(q.get("subscription_proration_date")).toBe(String(NOW.getTime() / 1000));
  });

  it("O10b change: an increase is invoiced now and applies only once paid; a decrease is credited later; the new name goes on a product", async () => {
    let pending: unknown = { expires_at: 1 };
    const { port, calls } = fakeStripe((m, url) => ({ json: url.endsWith("/products") ? { id: "prod_new" } : m === "POST" ? { id: "sub_9", pending_update: pending } : sub }));
    expect(await port.changePlan("sub_9", { priceCents: 2900, title: "Upgraded, monthly", increase: true, idempotencyKey: "tier_1" })).toEqual({ applied: false });
    const [, product, update] = calls;
    expect(product!.body!.get("name")).toBe("Upgraded, monthly");
    expect(product!.headers["Idempotency-Key"]).toBe("tier_1_product");
    expect(update!.body!.get("items[0][id]")).toBe("si_1");
    expect(update!.body!.get("items[0][price_data][product]")).toBe("prod_new");
    expect(update!.body!.get("items[0][price_data][unit_amount]")).toBe("2900");
    expect(update!.body!.get("proration_behavior")).toBe("always_invoice");
    expect(update!.body!.get("payment_behavior")).toBe("pending_if_incomplete");
    expect(update!.headers["Idempotency-Key"]).toBe("tier_1");
    pending = null;
    expect(await port.changePlan("sub_9", { priceCents: 1900, title: "Basic, monthly", increase: false, idempotencyKey: "tier_2" })).toEqual({ applied: true });
    expect(calls.at(-1)!.body!.get("proration_behavior")).toBe("create_prorations");
    expect(calls.at(-1)!.body!.get("payment_behavior")).toBeNull();
    await expect(port.changePlan("dev_1", { priceCents: 1, title: "x", increase: true, idempotencyKey: "k" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("O10b daily check reads the plan's status, stop flag and monthly amount; a non-Stripe reference is not asked about", async () => {
    const { port, calls } = fakeStripe(() => ({ json: { ...sub, status: "past_due", cancel_at_period_end: true } }));
    expect(await port.getPlan("sub_9")).toEqual({ status: "past_due", cancelAtPeriodEnd: true, unitAmountCents: 1900 });
    expect(await port.getPlan("dev_1")).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
