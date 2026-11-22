import type { Billing } from "@app-boilerplate/validation";

import { ServiceError } from "../services/errors";

// Payments port (/docs/features/access-and-checkout.md, /docs/code-quality.md section 12). The access
// service decides who gets what; a payments adapter only takes the money and reports what was paid.
//
// - "none":   purchases are closed. The safe default.
// - "dev":    a test checkout that charges nothing. Refused in production by the environment check
//             (packages/shared/src/env.ts), because it would give paid content away.
// - "stripe": Stripe's hosted checkout (lib/payments/stripe.ts). Card details never touch this site.

export type PaymentsProvider = "none" | "dev" | "stripe";

export type CheckoutOffer = { id: string; title: string; priceCents: number; billing: Billing; installmentCount: number };

/** A payment the provider confirms, in our words. */
export type ConfirmedPayment = { provider: string; providerPaymentId: string; amountCents: number; paidAt: Date };

/** A finished checkout as the provider reports it: which of our sessions, what was paid, and the plan's reference. */
export type CompletedCheckout = {
  /** Our checkout session's token, which we handed the provider when checkout started. */
  token: string;
  payment: ConfirmedPayment;
  /** The provider's subscription id for a monthly plan or payment plan; null for a one-time payment. */
  providerRef: string | null;
  /** When a free trial ends (the first charge); null when there is no trial (O10b). */
  trialEndsAt?: Date | null;
};

/** A plan as the provider sees it, for the daily check (O10b). */
export type ProviderPlan = {
  /** The provider's status word, for example active, trialing, past_due, canceled, unpaid. */
  status: string;
  cancelAtPeriodEnd: boolean;
  /** What the plan charges each month now, in cents; null when the provider did not say. */
  unitAmountCents: number | null;
};

/** What a verified provider notification means for us. */
export type PaymentEvent =
  | { kind: "checkout_completed"; providerSessionId: string }
  | { kind: "renewal"; providerRef: string; payment: ConfirmedPayment }
  /** A plan's payment failed; the provider retries on its own schedule (O10). */
  | { kind: "payment_failed"; providerRef: string }
  /** A plan was set to stop at the end of its period, or that was undone (from the member, the owner or the provider's dashboard). */
  | { kind: "plan_changed"; providerRef: string; cancelAtPeriodEnd: boolean }
  /** A plan was ended at the provider: no more payments. */
  | { kind: "plan_ended"; providerRef: string }
  /** Money was refunded; `refundedCents` is the payment's total refunded so far. `providerPaymentIds` are the ids it may be stored under. */
  | { kind: "refunded"; providerPaymentIds: string[]; refundedCents: number }
  /** The buyer's bank disputed a payment (a chargeback). */
  | { kind: "disputed"; providerPaymentIds: string[] }
  | { kind: "ignored" };

export type PaymentsPort = {
  readonly provider: PaymentsProvider;
  /** Starts paying for an offer. `token` names the checkout session; the result is where to send the member. */
  startCheckout(input: {
    token: string;
    offer: CheckoutOffer;
    /** The member's customer record at the provider (O10b), so receipts and history stay together. */
    customerId?: string | null;
    /** Free days before a monthly plan's first charge (O10b); 0 or absent means none. */
    trialDays?: number;
  }): Promise<{ redirectUrl: string }>;
  /** Stops future payments of a monthly plan or payment plan. Access continues to the paid date, then the grace period. */
  cancel(providerRef: string, when: "period_end" | "now"): Promise<void>;
  /** Asks the provider about a checkout it hosted; null when it is not paid (yet). Never trusts a client's claim. */
  getCompletedCheckout(providerSessionId: string): Promise<CompletedCheckout | null>;
  /** Verifies a notification's signature and reads it; throws `ServiceError("forbidden")` on a bad signature. */
  readEvent(rawBody: string, signature: string | null): Promise<PaymentEvent>;
  /**
   * Refunds part or all of a payment (O10). The idempotency key makes a repeated request (a retry or a
   * double click) refund once.
   */
  refund(providerPaymentId: string, amountCents: number, idempotencyKey: string): Promise<void>;
  /** Undoes "stop at the end of the period" on a plan that has not ended yet. */
  resume(providerRef: string): Promise<void>;
  /**
   * Creates the member's customer record (O10b). Null when this provider has none (test checkout). The
   * idempotency key makes two checkouts racing create one.
   */
  createCustomer(input: { userId: string; email: string | null; idempotencyKey: string }): Promise<string | null>;
  /**
   * Removes the member's customer record (name, email, saved cards) when they delete their account
   * (legal-gate AC11; Rich, 2026-11-18). The provider keeps its own payment and tax records. A record
   * already gone counts as done.
   */
  deleteCustomer(customerId: string): Promise<void>;
  /** The address of the provider's billing page for this customer: card, invoices, receipts, cancel (O10b). */
  billingPortal(customerId: string): Promise<{ url: string }>;
  /** What moving a plan to a new monthly price would charge now, prorated by the provider (O10b). */
  previewPlanChange(providerRef: string, priceCents: number): Promise<{ amountDueNowCents: number }>;
  /**
   * Moves a plan to a new monthly price and name (O10b). An increase is charged now, prorated, and applies
   * only if that payment succeeds (`applied: false` otherwise); a decrease applies at once and is credited
   * on the next bill.
   */
  changePlan(providerRef: string, input: { priceCents: number; title: string; increase: boolean; idempotencyKey: string }): Promise<{ applied: boolean }>;
  /** The plan as the provider has it; null when the reference is not one of this provider's plans. */
  getPlan(providerRef: string): Promise<ProviderPlan | null>;
};

const closed = () => new ServiceError("unavailable", "Purchases are not open yet.");
const noProvider = () => new ServiceError("not_found", "Not found");

export function createClosedPayments(): PaymentsPort {
  return {
    provider: "none",
    startCheckout: async () => {
      throw closed();
    },
    cancel: async () => {
      throw closed();
    },
    getCompletedCheckout: async () => null,
    readEvent: async () => {
      throw noProvider();
    },
    refund: async () => {
      throw closed();
    },
    resume: async () => {
      throw closed();
    },
    createCustomer: async () => null,
    deleteCustomer: async () => {},
    billingPortal: async () => {
      throw closed();
    },
    previewPlanChange: async () => {
      throw closed();
    },
    changePlan: async () => {
      throw closed();
    },
    getPlan: async () => null,
  };
}

/** The test checkout: sends the member to this site's own page, which completes without charging. */
export function createDevPayments(): PaymentsPort {
  return {
    provider: "dev",
    startCheckout: async ({ token }) => ({ redirectUrl: `/checkout/dev/${encodeURIComponent(token)}` }),
    cancel: async () => {},
    getCompletedCheckout: async () => null,
    readEvent: async () => {
      throw noProvider();
    },
    // The test checkout took no money, so there is nothing to give back; the site records the refund.
    refund: async () => {},
    resume: async () => {},
    // The test checkout keeps no customer records and has no billing page.
    createCustomer: async () => null,
    deleteCustomer: async () => {},
    billingPortal: async () => {
      throw new ServiceError("unavailable", "The test checkout has no billing page.");
    },
    // Nothing is charged in the test checkout, so a tier change costs nothing now and applies at once.
    previewPlanChange: async () => ({ amountDueNowCents: 0 }),
    changePlan: async () => ({ applied: true }),
    getPlan: async () => null,
  };
}
