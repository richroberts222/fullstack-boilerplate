import { z } from "zod";

import { uuidSchema } from "./common";

// Access contracts (/docs/features/access-and-checkout.md, /docs/features/grace-period.md): what the
// owner sells (offers), what a member holds (access), and the grace-period banner. Shared by the web
// app, the API and the mobile app; limits are product rules, so they live here once.

export const OFFER_TITLE_MAX = 120;
export const OFFER_DESCRIPTION_MAX = 2000;
/** One million dollars, in cents: anything above is a typing mistake, not a price. */
export const PRICE_CENTS_MAX = 100_000_000;
export const INSTALLMENTS_MIN = 2;
export const INSTALLMENTS_MAX = 36;
export const SCOPE_IDS_MAX = 200;
export const GRANT_REASON_MAX = 500;
/** Ten years: the longest fixed access length an offer can have. */
export const ACCESS_DAYS_MAX = 3650;

/** How an offer is paid: once, every month until stopped, or a fixed number of monthly payments. */
export const billingSchema = z.enum(["one_time", "monthly", "installments"]);
/** What an offer unlocks: everything, the listed groups, or the listed parts (the application says what its groups and parts are). */
export const scopeSchema = z.enum(["everything", "groups", "parts"]);

const titleSchema = z.string().trim().min(1, "Required").max(OFFER_TITLE_MAX, `At most ${OFFER_TITLE_MAX} characters`);
const descriptionSchema = z.string().trim().max(OFFER_DESCRIPTION_MAX, `At most ${OFFER_DESCRIPTION_MAX} characters`);
const priceSchema = z.number().int("Whole cents only").min(0).max(PRICE_CENTS_MAX, "Too large");
const scopeIdsSchema = z.array(uuidSchema).max(SCOPE_IDS_MAX);

// Edits replace every field, so the offer schema has no defaults (/docs/lessons.md): a partial edit
// must fail, never silently reset the price or what the offer unlocks.
const offerFields = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priceCents: priceSchema,
  billing: billingSchema,
  /** Only for installments: how many monthly payments make the offer owned. Ignored otherwise. */
  installmentCount: z.number().int().min(1).max(INSTALLMENTS_MAX),
  scope: scopeSchema,
  scopeIds: scopeIdsSchema,
  /** The upgraded tier: also unlocks the bonus content attached to what it covers. */
  includesBonus: z.boolean(),
  /** One-time offers only: how many days access lasts (365 = one year). Null means for good. */
  accessDays: z.number().int().min(1).max(ACCESS_DAYS_MAX).nullable(),
  isActive: z.boolean(),
});

type OfferFields = z.infer<typeof offerFields>;

/** The rules that tie the fields together; the same for create and edit. */
function checkOffer(o: OfferFields, ctx: z.RefinementCtx) {
  if (o.billing === "installments" && o.installmentCount < INSTALLMENTS_MIN) {
    ctx.addIssue({ code: "custom", path: ["installmentCount"], message: `A payment plan needs at least ${INSTALLMENTS_MIN} payments` });
  }
  if (o.accessDays !== null && o.billing !== "one_time") {
    ctx.addIssue({ code: "custom", path: ["accessDays"], message: "Only a one-time payment can last a set number of days" });
  }
  if (o.scope === "everything" && o.scopeIds.length > 0) {
    ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "Leave this empty when the offer unlocks everything" });
  }
  if (o.scope !== "everything" && o.scopeIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "Choose at least one" });
  }
  if (new Set(o.scopeIds).size !== o.scopeIds.length) {
    ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "Listed twice" });
  }
  if (o.isActive && o.priceCents === 0) {
    ctx.addIssue({ code: "custom", path: ["priceCents"], message: "Set a price before offering it (use a scholarship to give access free)" });
  }
}

export const createOfferSchema = offerFields.superRefine(checkOffer);
export const updateOfferSchema = offerFields.extend({ id: uuidSchema }).superRefine(checkOffer);
export const deleteOfferSchema = z.object({ id: uuidSchema });



/** The development checkout's "complete" step: the one-time token it was handed. */
export const completeDevCheckoutSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "Invalid checkout") });

/** Owner grants (the free-lifetime checkbox and scholarships). User ids are Clerk ids. */
export const clerkUserIdSchema = z.string().regex(/^user_[A-Za-z0-9]+$/, "Not a member id");
export const setLifetimeAccessSchema = z.object({ userId: clerkUserIdSchema, enabled: z.boolean() });
export const grantScholarshipSchema = z
  .object({
    userId: clerkUserIdSchema,
    scope: scopeSchema,
    scopeIds: scopeIdsSchema,
    /** When the scholarship ends; null means it never ends. ISO date (yyyy-mm-dd). */
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date").nullable(),
    /** Whether the scholarship also unlocks the bonus content. */
    includesBonus: z.boolean(),
    reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX),
  })
  .superRefine((g, ctx) => {
    if (g.scope === "everything" && g.scopeIds.length > 0) ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "Leave this empty for everything" });
    if (g.scope !== "everything" && g.scopeIds.length === 0) ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "Choose at least one" });
  });
export const revokeGrantSchema = z.object({ entitlementId: uuidSchema, reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX) });

/** The grace banner's three answers. */
export const graceAlertActionSchema = z.object({ action: z.enum(["snooze", "dismiss_forever"]) });

/** What anyone may see of an offer on the pricing page. */
export const publicOfferSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priceCents: z.number(),
  billing: billingSchema,
  installmentCount: z.number(),
  includesBonus: z.boolean(),
  accessDays: z.number().nullable(),
  /** What it covers, so the pricing page can group offers. Ids of what is sold are public. */
  scope: scopeSchema,
  scopeIds: z.array(z.string()),
});

export type Billing = z.infer<typeof billingSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type DeleteOfferInput = z.infer<typeof deleteOfferSchema>;

export type CompleteDevCheckoutInput = z.infer<typeof completeDevCheckoutSchema>;
export type SetLifetimeAccessInput = z.infer<typeof setLifetimeAccessSchema>;
export type GrantScholarshipInput = z.infer<typeof grantScholarshipSchema>;
export type RevokeGrantInput = z.infer<typeof revokeGrantSchema>;
export type GraceAlertActionInput = z.infer<typeof graceAlertActionSchema>;
export type PublicOffer = z.infer<typeof publicOfferSchema>;

/** "$29", "$29.50": how a price is shown. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars.toString() : dollars.toFixed(2)}`;
}

/** "$29 once", "$9 a month", "6 payments of $50". */
/** "1 year", "2 years", "90 days". */
export function describeAccessDays(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return days === 1 ? "1 day" : `${days} days`;
}

export function describeBilling(o: Pick<PublicOffer, "priceCents" | "billing" | "installmentCount"> & { accessDays?: number | null }): string {
  if (o.billing === "monthly") return `${formatPrice(o.priceCents)} a month`;
  if (o.billing === "installments") return `${o.installmentCount} monthly payments of ${formatPrice(o.priceCents)}`;
  if (o.accessDays) return `${formatPrice(o.priceCents)} for ${describeAccessDays(o.accessDays)}`;
  return `${formatPrice(o.priceCents)} once`;
}

// ----- Billing (O10) ------------------------------------------------------------------------------

/** The owner refunds part or all of one payment; null refunds everything not yet refunded. Audited. */
export const refundPaymentSchema = z.object({
  paymentId: uuidSchema,
  amountCents: z.number().int("Whole cents").min(1, "At least 1 cent").max(PRICE_CENTS_MAX).nullable(),
  reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

/** The owner stops a member's plan: at the end of the paid period, or now (access ends now). Audited. */
export const ownerCancelPlanSchema = z.object({
  entitlementId: uuidSchema,
  when: z.enum(["period_end", "now"]),
  reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX),
});
export type OwnerCancelPlanInput = z.infer<typeof ownerCancelPlanSchema>;

// ----- Billing, second half (O10b) ----------------------------------------------------------------

/**
 * A member moves their own monthly plan to the other tier of the same thing (basic to upgraded, or back).
 * The client names the plan and the offer to move to, never a price: the server quotes it.
 */
export const changePlanTierSchema = z.object({ entitlementId: uuidSchema, offerId: uuidSchema });
export type ChangePlanTierInput = z.infer<typeof changePlanTierSchema>;
