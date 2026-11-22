import { describe, expect, it } from "vitest";

import type { PaymentListRow } from "../../db/payments-read";
import { inAllowList } from "../auth/site-owner";
import { createServiceContext } from "./context";
import { createPaymentsReadService, PAYMENTS_PAGE } from "./payments-read";

// The owner's payments list (/docs/features/payments.md): only the owner reads it, and a member filter reaches the data layer.

const row: PaymentListRow = { id: "p1", userId: "user_a", entitlementId: "e1", title: "Plan", billing: "monthly", status: "active", planStopsAllowed: true, amountCents: 1000, refundedCents: 0, provider: "dev", paidAt: new Date("2026-01-01") };

function setup() {
  const calls: { limit: number; userId?: string }[] = [];
  const svc = createPaymentsReadService({ payments: { listRecent: async (limit, userId) => (calls.push({ limit, userId }), [row]) }, isSiteOwner: inAllowList(["user_owner"]) });
  return { svc, calls };
}

describe("payments read service", () => {
  it("refuses a member and reads nothing", async () => {
    const { svc, calls } = setup();
    await expect(svc.listPayments(createServiceContext("user_member"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });

  it("gives the owner the newest page, all or one member's", async () => {
    const { svc, calls } = setup();
    const owner = createServiceContext("user_owner");
    expect(await svc.listPayments(owner)).toEqual([row]);
    await svc.listPayments(owner, "user_a");
    expect(calls).toEqual([{ limit: PAYMENTS_PAGE, userId: undefined }, { limit: PAYMENTS_PAGE, userId: "user_a" }]);
  });
});
