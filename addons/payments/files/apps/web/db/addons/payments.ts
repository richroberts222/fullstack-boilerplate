import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Payments add-on (/docs/features/payments.md): what is sold, what each member holds, payments received,
// checkouts, coupons, scholarship amounts, the grace banner answer and the payment provider's customer id.
// `scope_ids` hold the application's own ids (groups or parts of what it sells); there is no foreign key to
// them, so this add-on knows nothing about the application's content tables.

/**
 * Something the owner sells (/docs/features/access-and-checkout.md): a price, how it is billed, and
 * what it unlocks. Prices and inclusions are the owner's to set, never code.
 */
export const offers = pgTable("offers", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  billing: text("billing").notNull(),
  installmentCount: integer("installment_count").notNull(),
  includesBonus: boolean("includes_bonus").notNull().default(false),
  accessDays: integer("access_days"),
  scope: text("scope").notNull(),
  scopeIds: jsonb("scope_ids").notNull(),
  isActive: boolean("is_active").notNull(),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What one member holds. What it unlocks is copied from the offer when it is granted, so a later edit
 * to the offer never changes what someone already bought. `paid_through` null means it never ends.
 */
export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    scope: text("scope").notNull(),
    scopeIds: jsonb("scope_ids").notNull(),
    billing: text("billing").notNull(),
    installmentCount: integer("installment_count").notNull(),
    installmentsPaid: integer("installments_paid").notNull(),
    includesBonus: boolean("includes_bonus").notNull().default(false),
    paidThrough: timestamp("paid_through", { withTimezone: true }),
    status: text("status").notNull(),
    priceCents: integer("price_cents"),
    reason: text("reason"),
    grantedBy: text("granted_by"),
    providerRef: text("provider_ref"),
    finalNoticeSentAt: timestamp("final_notice_sent_at", { withTimezone: true }),
    paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entitlements_user_idx").on(t.userId), uniqueIndex("entitlements_provider_ref_idx").on(t.providerRef)],
);

/** One payment received. The provider's payment id is unique, so a repeated notice is recorded once. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_user_idx").on(t.userId), uniqueIndex("payments_provider_payment_idx").on(t.provider, t.providerPaymentId)],
);

/** A checkout a member started. Completing it twice grants access once. */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: uuid("id").primaryKey(),
    token: text("token").notNull(),
    userId: text("user_id").notNull(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    priceCents: integer("price_cents"),
    couponId: uuid("coupon_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("checkout_sessions_token_idx").on(t.token)],
);

/**
 * A discount code the owner creates (/docs/features/access-and-checkout.md, O7): a percent or a fixed
 * amount in cents, optionally limited to some offers, an end date and a number of uses. Codes are
 * stored upper case and are unique.
 */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
    kind: text("kind").notNull(),
    value: integer("value").notNull(),
    offerIds: jsonb("offer_ids").notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    isActive: boolean("is_active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupons_code_idx").on(t.code)],
);

/**
 * A scholarship amount (O7): the owner lowers what one member pays, by a percent or a fixed amount in
 * cents, on chosen offers or all of them. Free access is a scholarship grant instead (an entitlement).
 */
export const memberDiscounts = pgTable(
  "member_discounts",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    value: integer("value").notNull(),
    offerIds: jsonb("offer_ids").notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    reason: text("reason").notNull(),
    grantedBy: text("granted_by").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("member_discounts_user_idx").on(t.userId)],
);

export const accessAlertPrefs = pgTable("access_alert_prefs", {
  userId: text("user_id").primaryKey(),
  dismissedForeverAt: timestamp("dismissed_forever_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The payment provider's customer record for a member (/docs/features/access-and-checkout.md AC34, O10b):
 * one per member and provider, reused for every checkout so receipts and history stay together.
 */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);
