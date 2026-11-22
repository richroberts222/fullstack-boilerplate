import type { AccessRepo } from "../../db/access";
import type { PaymentsPort } from "../payments/ports";

// What must happen at the payment provider before a member's account is deleted (legal gate AC11,
// /docs/features/payments.md): plans that still bill are stopped now, so nobody is charged after deleting, and the
// provider's customer record (name, email, saved cards) is removed. If either fails, the error is thrown and the
// caller deletes nothing.

export type BillingStopDeps = {
  repo: Pick<AccessRepo, "listEntitlementsForUser" | "findBillingCustomer">;
  payments: Pick<PaymentsPort, "provider" | "cancel" | "deleteCustomer">;
};

export function createBillingStopper(deps: BillingStopDeps) {
  return async function stopBilling(userId: string): Promise<{ plansStopped: number; customerRemoved: boolean }> {
    const billing = (await deps.repo.listEntitlementsForUser(userId)).filter(
      (e) => e.source === "purchase" && e.billing !== "one_time" && e.providerRef !== null && e.paidThrough !== null && e.status !== "revoked",
    );
    for (const e of billing) await deps.payments.cancel(e.providerRef!, "now");
    const customerId = await deps.repo.findBillingCustomer(userId, deps.payments.provider);
    if (customerId) await deps.payments.deleteCustomer(customerId);
    return { plansStopped: billing.length, customerRemoved: customerId !== null };
  };
}
