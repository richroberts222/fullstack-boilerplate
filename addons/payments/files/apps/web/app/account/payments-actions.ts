"use server";

import {
  changePlanTierSchema,
  completeDevCheckoutSchema,
  graceAlertActionSchema,
  quoteSchema,
  startCheckoutSchema,
  uuidSchema,
} from "@app-boilerplate/validation";
import { z } from "zod";

import { act } from "@/lib/actions";
import { getAccessService } from "@/lib/addons/payments";

// The payments add-on's member actions (/docs/features/payments.md). The access service decides everything:
// whether the offer is for sale, whose plan it is, whether the test checkout exists at all. A client sends an
// offer id and, at most, a coupon code: never a price, a discount or a total.

const access = () => getAccessService();
const planSchema = z.object({ entitlementId: uuidSchema });

export const startCheckout = async (raw: unknown) => act(startCheckoutSchema, raw, (c, i) => access().startCheckout(c, i), { limit: "checkout" });
export const completeDevCheckout = async (raw: unknown) => act(completeDevCheckoutSchema, raw, (c, i) => access().completeDevCheckout(c, i));
export const cancelPlan = async (raw: unknown) => act(planSchema, raw, (c, i) => access().cancelPlan(c, i.entitlementId), { limit: "billing" });
/** Starts a stopped plan again before its paid date. */
export const resumePlan = async (raw: unknown) => act(planSchema, raw, (c, i) => access().resumePlan(c, i.entitlementId), { limit: "billing" });
/** "Manage billing": the payment provider's page for the member's card, invoices and receipts. */
export const openBillingPortal = async (raw: unknown) => act(z.object({}).strict(), raw, (c) => access().openBillingPortal(c), { limit: "billing" });
/** Upgrade or downgrade a monthly plan: first the price, then the change. The server quotes every amount. */
export const previewTierChange = async (raw: unknown) => act(changePlanTierSchema, raw, (c, i) => access().previewTierChange(c, i), { limit: "billing" });
export const changeTier = async (raw: unknown) => act(changePlanTierSchema, raw, (c, i) => access().changeTier(c, i), { limit: "billing" });
export const payNextDevPayment = async (raw: unknown) => act(planSchema, raw, (c, i) => access().payNextDevPayment(c, i.entitlementId));
export const answerGraceAlert = async (raw: unknown) => act(graceAlertActionSchema, raw, (c, i) => access().answerGraceAlert(c, i));
/** What an offer costs this member, with an optional code (shown before they pay; the checkout recomputes it). */
export const quoteOffer = async (raw: unknown) => act(quoteSchema, raw, (c, i) => access().quote(c, i), { limit: "quote" });
