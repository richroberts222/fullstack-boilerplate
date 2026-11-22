import type { PaymentListRow, PaymentsReader } from "../../db/payments-read";
import { authorize, type Rule } from "../auth/authorize";
import type { ServiceContext } from "./context";

// The owner's list of payments (/docs/features/payments.md): read only. Refunds and stopping plans go through the
// access service, which refunds at the provider and writes the audit entry.

export const PAYMENTS_PAGE = 500;

export type PaymentsReadDeps = { payments: PaymentsReader; isSiteOwner: Rule };

export function createPaymentsReadService(deps: PaymentsReadDeps) {
  return {
    /** The newest payments first, all or one member's. Owner only. */
    async listPayments(ctx: ServiceContext, userId?: string): Promise<PaymentListRow[]> {
      await authorize(ctx.actor, deps.isSiteOwner, undefined);
      return deps.payments.listRecent(PAYMENTS_PAGE, userId);
    },
  };
}

export type PaymentsReadService = ReturnType<typeof createPaymentsReadService>;
