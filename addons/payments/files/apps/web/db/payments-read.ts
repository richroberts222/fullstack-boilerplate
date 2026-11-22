import { desc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { entitlements, payments } from "./schema";

// Read side of payments, for the owner's payments list and the accountant's export (S10,
// /docs/features/payments.md). Nothing here changes a row; refunds go through the access
// service so they are made at the provider and audited.

export type PaymentListRow = {
  id: string;
  userId: string;
  entitlementId: string;
  title: string;
  billing: string;
  /** The plan's status: active, canceled or revoked. */
  status: string;
  /** Whether the provider still bills this plan (the owner may stop it). */
  planStopsAllowed: boolean;
  amountCents: number;
  refundedCents: number;
  provider: string;
  paidAt: Date;
};

export type PaymentsReader = { listRecent(limit: number, userId?: string): Promise<PaymentListRow[]> };

export function createPaymentsReader(db: Database): PaymentsReader {
  return {
    listRecent: (limit, userId) =>
      withDbErrors("payments.listRecent", async () => {
        const base = db
          .select({
            id: payments.id,
            userId: payments.userId,
            entitlementId: payments.entitlementId,
            title: entitlements.title,
            billing: entitlements.billing,
            status: entitlements.status,
            source: entitlements.source,
            providerRef: entitlements.providerRef,
            paidThrough: entitlements.paidThrough,
            amountCents: payments.amountCents,
            refundedCents: payments.refundedCents,
            provider: payments.provider,
            paidAt: payments.paidAt,
          })
          .from(payments)
          .innerJoin(entitlements, eq(entitlements.id, payments.entitlementId));
        const rows = await (userId ? base.where(eq(payments.userId, userId)) : base).orderBy(desc(payments.paidAt)).limit(limit);
        return rows.map(({ source, providerRef, paidThrough, ...r }) => ({
          ...r,
          planStopsAllowed: source === "purchase" && r.billing !== "one_time" && providerRef !== null && paidThrough !== null && r.status !== "revoked",
        }));
      }),
  };
}
