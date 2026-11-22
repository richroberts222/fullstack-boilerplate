"use server";

import {
  createCouponSchema,
  createOfferSchema,
  deleteOfferSchema,
  grantDiscountSchema,
  grantScholarshipSchema,
  ownerCancelPlanSchema,
  refundPaymentSchema,
  revokeDiscountSchema,
  revokeGrantSchema,
  setLifetimeAccessSchema,
  updateCouponSchema,
  updateOfferSchema,
  updatePaymentsSettingsSchema,
} from "@app-boilerplate/validation";

import { act } from "@/lib/actions";
import { getAccessService, getPaymentsSettingsService, getPricingService } from "@/lib/addons/payments";

// The payments add-on's owner actions (/docs/features/payments.md). Each one: identity from Clerk, untrusted
// input parsed with the shared schema, then the service, which checks the owner and writes an audit entry.

const access = () => getAccessService();

export const createOffer = async (raw: unknown) => act(createOfferSchema, raw, (c, i) => access().createOffer(c, i));
export const updateOffer = async (raw: unknown) => act(updateOfferSchema, raw, (c, i) => access().updateOffer(c, i));
export const deleteOffer = async (raw: unknown) => act(deleteOfferSchema, raw, (c, i) => access().deleteOffer(c, i));
export const setLifetimeAccess = async (raw: unknown) => act(setLifetimeAccessSchema, raw, (c, i) => access().setLifetimeAccess(c, i));
export const grantScholarship = async (raw: unknown) => act(grantScholarshipSchema, raw, (c, i) => access().grantScholarship(c, i));
export const revokeGrant = async (raw: unknown) => act(revokeGrantSchema, raw, (c, i) => access().revokeGrant(c, i));
export const createCoupon = async (raw: unknown) => act(createCouponSchema, raw, (c, i) => getPricingService().createCoupon(c, i));
export const updateCoupon = async (raw: unknown) => act(updateCouponSchema, raw, (c, i) => getPricingService().updateCoupon(c, i));
export const grantDiscount = async (raw: unknown) => act(grantDiscountSchema, raw, (c, i) => getPricingService().grantDiscount(c, i));
export const revokeDiscount = async (raw: unknown) => act(revokeDiscountSchema, raw, (c, i) => getPricingService().revokeDiscount(c, i));
/** Billing: refund part or all of a payment, or stop a member's plan. Both audited. */
export const refundPayment = async (raw: unknown) => act(refundPaymentSchema, raw, (c, i) => access().refundPayment(c, i));
export const ownerCancelPlan = async (raw: unknown) => act(ownerCancelPlanSchema, raw, (c, i) => access().ownerCancelPlan(c, i));
export const updatePaymentsSettings = async (raw: unknown) => act(updatePaymentsSettingsSchema, raw, (c, i) => getPaymentsSettingsService().updateSettings(c, i));
