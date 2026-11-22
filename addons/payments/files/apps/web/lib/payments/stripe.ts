import { createHmac, timingSafeEqual } from "node:crypto";

import { ServiceError } from "../services/errors";
import type { CompletedCheckout, ConfirmedPayment, PaymentEvent, PaymentsPort, ProviderPlan } from "./ports";

// Stripe adapter (/docs/payments.md, /docs/features/access-and-checkout.md, O2). The only code that talks
// to Stripe. It uses Stripe's REST API directly (no SDK dependency) with a pinned API version, so the
// fields read below cannot change under us. Hosted checkout only: card details never reach this site.
// It never decides access: it reports what Stripe confirms, and the access service decides.

export const STRIPE_API_VERSION = "2024-06-20";
/** How old a signed notification may be before it is refused as a replay (Stripe's own default). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  /** This deployment's address, for Stripe to send the buyer back to. */
  siteUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/** Stripe's form encoding: nested objects become `a[b][c]=v`. */
export function toForm(value: Record<string, unknown>, prefix = ""): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (typeof v === "object") for (const [k, inner] of Object.entries(v as Record<string, unknown>)) walk(inner, key ? `${key}[${k}]` : k);
    else out.append(key, String(v));
  };
  walk(value, prefix);
  return out;
}

/**
 * Checks a `Stripe-Signature` header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, possibly
 * several v1 values (during a secret roll). Constant-time comparison; too old is refused.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string, now: Date): boolean {
  if (!header || secret === "") return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  return signatures.some((s) => {
    if (!/^[0-9a-f]{64}$/.test(s)) return false;
    return timingSafeEqual(Buffer.from(s, "hex"), expected);
  });
}

type StripeObject = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as StripeObject).id) : null);

export function createStripePayments(config: StripeConfig): PaymentsPort {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());

  /**
   * One Stripe request. Every write carries an Idempotency-Key (O10): the caller's when the operation has a
   * natural one (a checkout token, a refund), otherwise a fresh one. If the network fails before Stripe
   * answers, the same request is sent once more with the same key, so Stripe performs it at most once.
   */
  async function call(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, idempotencyKey?: string, opts: { missingOk?: boolean } = {}): Promise<StripeObject> {
    const key = method === "GET" ? undefined : (idempotencyKey ?? crypto.randomUUID());
    // A read sends its parameters in the address; a write sends them as a form.
    const query = method === "GET" && body ? `?${toForm(body).toString()}` : "";
    const form = method === "GET" ? undefined : body;
    const send = () =>
      doFetch(`https://api.stripe.com/v1/${path}${query}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
          ...(key ? { "Idempotency-Key": key } : {}),
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? toForm(form).toString() : undefined,
      });
    let res: Response;
    try {
      res = await send();
    } catch {
      res = await send();
    }
    const json = (await res.json().catch(() => ({}))) as StripeObject;
    // Deleting something Stripe no longer has is already done (for example removed in its dashboard).
    if (res.status === 404 && opts.missingOk) return {};
    if (!res.ok) {
      // Stripe's message may name internal ids; log the type only, show the buyer a plain message.
      const type = str((json.error as StripeObject | undefined)?.type) ?? `http_${res.status}`;
      // An unexpected error: reported (with no key or card data) and shown to the buyer as a plain failure.
      throw new Error(`stripe ${method} ${path.split("/")[0]}: ${type}`);
    }
    return json;
  }

  const isPlan = (ref: string) => /^sub_[A-Za-z0-9]+$/.test(ref);

  /** A plan's one line item: its id, product and current monthly amount. */
  async function planItem(providerRef: string) {
    const sub = await call("GET", `subscriptions/${providerRef}`);
    const item = (((sub.items as StripeObject | undefined)?.data as StripeObject[] | undefined) ?? [])[0];
    const price = (item?.price ?? {}) as StripeObject;
    const id = str(item?.id);
    const product = idOf(price.product);
    if (!id || !product) throw new ServiceError("conflict", "This plan cannot be changed here.");
    return { sub, id, product, unitAmount: num(price.unit_amount) };
  }

  const monthlyPrice = (product: string, priceCents: number) => ({ currency: "usd", product, unit_amount: priceCents, recurring: { interval: "month" } });

  return {
    provider: "stripe",

    async startCheckout({ token, offer, customerId, trialDays }) {
      const recurring = offer.billing !== "one_time";
      const priceData = {
        currency: "usd",
        unit_amount: offer.priceCents,
        product_data: { name: offer.title },
        ...(recurring ? { recurring: { interval: "month" } } : {}),
      };
      const session = await call("POST", "checkout/sessions", {
        mode: recurring ? "subscription" : "payment",
        client_reference_id: token,
        line_items: { 0: { price_data: priceData, quantity: 1 } },
        metadata: { token },
        // The member's customer record, so receipts and history stay together; a one-time payment is
        // filed under it too.
        ...(customerId ? { customer: customerId } : {}),
        ...(customerId && !recurring ? { invoice_creation: { enabled: true } } : {}),
        ...(recurring
          ? { subscription_data: { metadata: { token }, ...(offer.billing === "monthly" && trialDays && trialDays > 0 ? { trial_period_days: trialDays } : {}) } }
          : { payment_intent_data: { metadata: { token } } }),
        success_url: `${config.siteUrl}/checkout/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.siteUrl}/pricing`,
      }, `checkout_${token}`);
      const url = str(session.url);
      if (!url) throw new ServiceError("unavailable", "The payment service did not answer. Please try again in a moment.");
      return { redirectUrl: url };
    },

    async cancel(providerRef, when) {
      if (!/^sub_[A-Za-z0-9]+$/.test(providerRef)) return; // not a Stripe plan (for example a test-checkout one)
      if (when === "now") await call("DELETE", `subscriptions/${providerRef}`);
      else await call("POST", `subscriptions/${providerRef}`, { cancel_at_period_end: true });
    },

    async refund(providerPaymentId, amountCents, idempotencyKey) {
      // A one-time payment is stored under its payment intent; a plan's payment under its invoice, whose
      // payment intent is looked up.
      let paymentIntent = /^pi_[A-Za-z0-9]+$/.test(providerPaymentId) ? providerPaymentId : null;
      if (!paymentIntent && /^in_[A-Za-z0-9]+$/.test(providerPaymentId)) paymentIntent = idOf((await call("GET", `invoices/${providerPaymentId}`)).payment_intent);
      if (!paymentIntent) throw new ServiceError("conflict", "This payment cannot be refunded here.");
      await call("POST", "refunds", { payment_intent: paymentIntent, amount: amountCents }, idempotencyKey);
    },

    async resume(providerRef) {
      if (!/^sub_[A-Za-z0-9]+$/.test(providerRef)) return;
      await call("POST", `subscriptions/${providerRef}`, { cancel_at_period_end: false });
    },

    async deleteCustomer(customerId) {
      if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) return; // not a Stripe customer
      await call("DELETE", `customers/${customerId}`, undefined, `delete_${customerId}`, { missingOk: true });
    },

    async createCustomer({ userId, email, idempotencyKey }) {
      const customer = await call("POST", "customers", { ...(email ? { email } : {}), metadata: { userId } }, idempotencyKey);
      const id = str(customer.id);
      if (!id) throw new ServiceError("unavailable", "The payment service did not answer. Please try again in a moment.");
      return id;
    },

    async billingPortal(customerId) {
      if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new ServiceError("not_found", "Not found");
      const session = await call("POST", "billing_portal/sessions", { customer: customerId, return_url: `${config.siteUrl}/dashboard` });
      const url = str(session.url);
      if (!url) throw new ServiceError("unavailable", "The payment service did not answer. Please try again in a moment.");
      return { url };
    },

    async previewPlanChange(providerRef, priceCents) {
      if (!isPlan(providerRef)) throw new ServiceError("conflict", "This plan cannot be changed here.");
      const item = await planItem(providerRef);
      // Stripe's own preview of the next invoice with the change; its proration lines are what an
      // increase charges now (a decrease shows a credit, which is never charged now).
      const preview = await call("GET", "invoices/upcoming", {
        subscription: providerRef,
        subscription_items: { 0: { id: item.id, price_data: monthlyPrice(item.product, priceCents) } },
        subscription_proration_behavior: "always_invoice",
        subscription_proration_date: Math.floor(now().getTime() / 1000),
      });
      const lines = (((preview.lines as StripeObject | undefined)?.data as StripeObject[] | undefined) ?? []).filter((l) => l.proration === true);
      const total = lines.reduce((sum, l) => sum + (num(l.amount) ?? 0), 0);
      return { amountDueNowCents: Math.max(0, total) };
    },

    async changePlan(providerRef, { priceCents, title, increase, idempotencyKey }) {
      if (!isPlan(providerRef)) throw new ServiceError("conflict", "This plan cannot be changed here.");
      const item = await planItem(providerRef);
      // A product per change keeps the new name on invoices; the key keeps a retry from making two.
      const product = str((await call("POST", "products", { name: title }, `${idempotencyKey}_product`)).id);
      if (!product) throw new ServiceError("unavailable", "The payment service did not answer. Please try again in a moment.");
      const updated = await call(
        "POST",
        `subscriptions/${providerRef}`,
        {
          items: { 0: { id: item.id, price_data: monthlyPrice(product, priceCents) } },
          // An increase is billed now and applies only once paid; a decrease is credited on the next bill.
          proration_behavior: increase ? "always_invoice" : "create_prorations",
          ...(increase ? { payment_behavior: "pending_if_incomplete" } : {}),
        },
        idempotencyKey,
      );
      return { applied: !updated.pending_update };
    },

    async getPlan(providerRef): Promise<ProviderPlan | null> {
      if (!isPlan(providerRef)) return null;
      const { sub, unitAmount } = await planItem(providerRef);
      return { status: str(sub.status) ?? "unknown", cancelAtPeriodEnd: sub.cancel_at_period_end === true, unitAmountCents: unitAmount };
    },

    async getCompletedCheckout(providerSessionId): Promise<CompletedCheckout | null> {
      if (!/^cs_[A-Za-z0-9_]+$/.test(providerSessionId)) return null;
      // The plan comes back whole, so a free trial's end can be read.
      const s = await call("GET", `checkout/sessions/${providerSessionId}`, { expand: { 0: "subscription" } });
      const token = str(s.client_reference_id);
      const status = str(s.payment_status);
      const amount = num(s.amount_total);
      if (!token || amount === null || (status !== "paid" && status !== "no_payment_required")) return null;
      const subscription = idOf(s.subscription);
      const trialEnd = s.subscription && typeof s.subscription === "object" ? num((s.subscription as StripeObject).trial_end) : null;
      const trialEndsAt = subscription && trialEnd !== null && status === "no_payment_required" ? new Date(trialEnd * 1000) : null;
      // "No payment required" with money due and no trial is not a confirmed payment.
      if (status === "no_payment_required" && amount > 0 && !trialEndsAt) return null;
      // A one-time payment is named by its payment intent; a plan's first payment by its first invoice
      // (a trial's is a zero invoice; without one, the plan names it).
      const paymentId = subscription ? (idOf(s.invoice) ?? (trialEndsAt ? `trial_${subscription}` : null)) : idOf(s.payment_intent);
      if (!paymentId) return null;
      const created = num(s.created);
      const payment: ConfirmedPayment = { provider: "stripe", providerPaymentId: paymentId, amountCents: amount, paidAt: created !== null ? new Date(created * 1000) : now() };
      return { token, payment, providerRef: subscription, trialEndsAt };
    },

    async readEvent(rawBody, signature): Promise<PaymentEvent> {
      if (!verifySignature(rawBody, signature, config.webhookSecret, now())) throw new ServiceError("forbidden", "Bad signature");
      const event = JSON.parse(rawBody) as StripeObject;
      const object = ((event.data as StripeObject | undefined)?.object ?? {}) as StripeObject;
      const type = str(event.type);
      if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
        const id = str(object.id);
        return id ? { kind: "checkout_completed", providerSessionId: id } : { kind: "ignored" };
      }
      if (type === "invoice.paid") {
        // The first invoice of a plan is the checkout itself (handled above); later ones are renewals.
        if (str(object.billing_reason) !== "subscription_cycle") return { kind: "ignored" };
        const sub = idOf(object.subscription);
        const id = str(object.id);
        const amount = num(object.amount_paid);
        const paidAt = num((object.status_transitions as StripeObject | undefined)?.paid_at) ?? num(object.created);
        if (!sub || !id || amount === null) return { kind: "ignored" };
        return { kind: "renewal", providerRef: sub, payment: { provider: "stripe", providerPaymentId: id, amountCents: amount, paidAt: paidAt !== null ? new Date(paidAt * 1000) : now() } };
      }
      if (type === "invoice.payment_failed") {
        const sub = idOf(object.subscription);
        return sub ? { kind: "payment_failed", providerRef: sub } : { kind: "ignored" };
      }
      if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
        const sub = str(object.id);
        if (!sub) return { kind: "ignored" };
        if (type === "customer.subscription.deleted") return { kind: "plan_ended", providerRef: sub };
        return { kind: "plan_changed", providerRef: sub, cancelAtPeriodEnd: object.cancel_at_period_end === true };
      }
      if (type === "charge.refunded") {
        const refunded = num(object.amount_refunded);
        const ids = [idOf(object.invoice), idOf(object.payment_intent)].filter((v): v is string => v !== null);
        return refunded !== null && ids.length > 0 ? { kind: "refunded", providerPaymentIds: ids, refundedCents: refunded } : { kind: "ignored" };
      }
      if (type === "charge.dispute.created") {
        // A dispute names the charge; the charge says which invoice (a plan's payment) it belongs to.
        const chargeId = idOf(object.charge);
        const charge = chargeId && /^ch_[A-Za-z0-9]+$/.test(chargeId) ? await call("GET", `charges/${chargeId}`) : {};
        const ids = [idOf(charge.invoice), idOf(object.payment_intent) ?? idOf(charge.payment_intent)].filter((v): v is string => v !== null);
        return ids.length > 0 ? { kind: "disputed", providerPaymentIds: ids } : { kind: "ignored" };
      }
      return { kind: "ignored" };
    },
  };
}
