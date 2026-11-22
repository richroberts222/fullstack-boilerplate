import { z } from "zod";

import { clerkUserIdSchema, GRANT_REASON_MAX, PRICE_CENTS_MAX, SCOPE_IDS_MAX } from "./access";
import { uuidSchema } from "./common";

// Pricing contracts (/docs/features/access-and-checkout.md, O7): coupon codes and scholarship amounts.
// Prices are computed on the server only; a client sends an offer id and, at most, a coupon code.

export const COUPON_USES_MAX = 1_000_000;

/** A code as the buyer types it: spaces trimmed, any case; stored and compared upper case. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, "3 to 32 letters, numbers, - or _");

/** How a discount lowers a price: by a percent (1 to 100) or by a fixed amount in cents. */
export const discountKindSchema = z.enum(["percent", "amount"]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const offerIdsSchema = z.array(uuidSchema).max(SCOPE_IDS_MAX);

const discountFields = {
  kind: discountKindSchema,
  value: z.number().int("Whole numbers only").min(1, "At least 1"),
  /** The offers it applies to; empty means every offer. */
  offerIds: offerIdsSchema,
  /** The last day it works (UTC), or null for no end. */
  endsOn: dateSchema.nullable(),
};

function checkDiscount(d: { kind: "percent" | "amount"; value: number; offerIds: string[] }, ctx: z.RefinementCtx) {
  if (d.kind === "percent" && d.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "At most 100 percent" });
  if (d.kind === "amount" && d.value > PRICE_CENTS_MAX) ctx.addIssue({ code: "custom", path: ["value"], message: "Too large" });
  if (new Set(d.offerIds).size !== d.offerIds.length) ctx.addIssue({ code: "custom", path: ["offerIds"], message: "Listed twice" });
}

// No defaults (/docs/lessons.md): an edit that left a field out would otherwise reset it.
const couponFields = z.object({
  ...discountFields,
  maxUses: z.number().int().min(1).max(COUPON_USES_MAX).nullable(),
  isActive: z.boolean(),
});
/** New codes are 8 to 32 characters (owner decision); older short codes still work for buyers. */
export const createCouponSchema = couponFields
  .extend({ code: couponCodeSchema.pipe(z.string().min(8, "At least 8 characters")) })
  .superRefine(checkDiscount);
/** The code itself cannot change after creation: receipts and people already hold it. */
export const updateCouponSchema = couponFields.extend({ id: uuidSchema }).superRefine(checkDiscount);

export const grantDiscountSchema = z
  .object({ userId: clerkUserIdSchema, ...discountFields, reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX) })
  .superRefine(checkDiscount);
export const revokeDiscountSchema = z.object({ id: uuidSchema, reason: z.string().trim().min(1, "Say why, for the record").max(GRANT_REASON_MAX) });

/** An optional code from a form: empty means none. */
export const optionalCouponCodeSchema = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), couponCodeSchema.optional());

/** Ask what an offer costs this viewer, with an optional code. */
export const quoteSchema = z.object({ offerId: uuidSchema, couponCode: optionalCouponCodeSchema });

/** What a quote shows: the offer's price, each reduction, and what will be charged per payment. */
export type Quote = {
  offerId: string;
  listCents: number;
  /** The member's scholarship amount, in cents off each payment (0 when none). */
  scholarshipCents: number;
  /** The coupon, in cents off each payment (0 when none). */
  couponCents: number;
  /** What each payment costs after both; never below zero. */
  finalCents: number;
  couponCode: string | null;
};

export type DiscountKind = z.infer<typeof discountKindSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type GrantDiscountInput = z.infer<typeof grantDiscountSchema>;
export type RevokeDiscountInput = z.infer<typeof revokeDiscountSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;

/** A member starts checkout for one offer, with an optional coupon code. */
export const startCheckoutSchema = quoteSchema;
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;
