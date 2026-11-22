import { and, eq, ne } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import type { AccountDataPart } from "./legal";
import { accessAlertPrefs, billingCustomers, checkoutSessions, entitlements, memberDiscounts, payments } from "./addons/payments";

// The payments add-on's share of a member's data for "Download my data" and "Delete my account"
// (/docs/features/legal-gate.md "Account data parts", /docs/data-inventory.md "Payments (add-on)").
// Deleted with the account: price reductions, banner answers, checkout sessions, billing customer
// records and owner grants. Kept for tax records (7 years) with the member id replaced by `anonId`:
// purchases and their payments.

export function paymentsAccountData(db: Database, hooks: { beforeDelete?: (userId: string) => Promise<void> } = {}): AccountDataPart[] {
  return [
    {
      name: "access",
      tables: ["entitlements"],
      // Stops plans that still bill and removes the provider's customer record before anything is deleted.
      beforeDelete: hooks.beforeDelete,
      exportFor: (userId) =>
        withDbErrors("payments.exportAccess", () =>
          db
            .select({
              id: entitlements.id,
              source: entitlements.source,
              title: entitlements.title,
              scope: entitlements.scope,
              scopeIds: entitlements.scopeIds,
              billing: entitlements.billing,
              includesBonus: entitlements.includesBonus,
              paidThrough: entitlements.paidThrough,
              status: entitlements.status,
              priceCents: entitlements.priceCents,
              reason: entitlements.reason,
              createdAt: entitlements.createdAt,
            })
            .from(entitlements)
            .where(eq(entitlements.userId, userId)),
        ),
      deletionStatements: (userId, anonId) => [
        db.delete(entitlements).where(and(eq(entitlements.userId, userId), ne(entitlements.source, "purchase"))),
        db.update(entitlements).set({ userId: anonId }).where(eq(entitlements.userId, userId)),
      ],
    },
    {
      name: "payments",
      tables: ["payments"],
      exportFor: (userId) =>
        withDbErrors("payments.exportPayments", () =>
          db
            .select({ id: payments.id, entitlementId: payments.entitlementId, amountCents: payments.amountCents, provider: payments.provider, paidAt: payments.paidAt })
            .from(payments)
            .where(eq(payments.userId, userId)),
        ),
      deletionStatements: (userId, anonId) => [db.update(payments).set({ userId: anonId }).where(eq(payments.userId, userId))],
    },
    {
      name: "priceReductions",
      tables: ["member_discounts"],
      exportFor: (userId) =>
        withDbErrors("payments.exportDiscounts", () =>
          db
            .select({ id: memberDiscounts.id, kind: memberDiscounts.kind, value: memberDiscounts.value, offerIds: memberDiscounts.offerIds, endsAt: memberDiscounts.endsAt, reason: memberDiscounts.reason, status: memberDiscounts.status, createdAt: memberDiscounts.createdAt })
            .from(memberDiscounts)
            .where(eq(memberDiscounts.userId, userId)),
        ),
      deletionStatements: (userId) => [db.delete(memberDiscounts).where(eq(memberDiscounts.userId, userId))],
    },
    {
      name: "bannerAnswers",
      tables: ["access_alert_prefs"],
      exportFor: (userId) =>
        withDbErrors("payments.exportPrefs", () =>
          db.select({ dismissedForeverAt: accessAlertPrefs.dismissedForeverAt, snoozedUntil: accessAlertPrefs.snoozedUntil }).from(accessAlertPrefs).where(eq(accessAlertPrefs.userId, userId)),
        ),
      deletionStatements: (userId) => [db.delete(accessAlertPrefs).where(eq(accessAlertPrefs.userId, userId))],
    },
    {
      name: "billingAccounts",
      tables: ["billing_customers"],
      exportFor: (userId) =>
        withDbErrors("payments.exportBilling", () =>
          db
            .select({ provider: billingCustomers.provider, providerCustomerId: billingCustomers.providerCustomerId, createdAt: billingCustomers.createdAt })
            .from(billingCustomers)
            .where(eq(billingCustomers.userId, userId)),
        ),
      deletionStatements: (userId) => [db.delete(billingCustomers).where(eq(billingCustomers.userId, userId))],
    },
    {
      name: "checkouts",
      tables: ["checkout_sessions"],
      exportFor: async () => [],
      deletionStatements: (userId) => [db.delete(checkoutSessions).where(eq(checkoutSessions.userId, userId))],
    },
    {
      // The audit trail names the owner who acted and is kept on purpose (/docs/permissions.md rule 6):
      // nothing is exported or deleted, and the inventory says why.
      name: "auditTrail",
      tables: ["audit_events"],
      exportFor: async () => [],
      deletionStatements: () => [],
    },
  ];
}
