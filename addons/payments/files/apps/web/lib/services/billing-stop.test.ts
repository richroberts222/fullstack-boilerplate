import { describe, expect, it } from "vitest";

import type { EntitlementRow } from "../../db/access";
import { createBillingStopper } from "./billing-stop";

// Deleting an account must first stop every plan that still bills and remove the provider's customer record
// (legal gate AC11, /docs/features/payments.md), and a failure must stop the deletion.

const row = (over: Partial<EntitlementRow>): EntitlementRow =>
  ({ id: "e", userId: "user_a", source: "purchase", billing: "monthly", providerRef: "sub_1", paidThrough: new Date("2030-01-01"), status: "active", ...over }) as EntitlementRow;

function setup(rows: EntitlementRow[], customer: string | null, failCancel = false) {
  const calls: string[] = [];
  const stop = createBillingStopper({
    repo: { listEntitlementsForUser: async () => rows, findBillingCustomer: async () => customer },
    payments: {
      provider: "stripe",
      cancel: async (ref, when) => {
        if (failCancel) throw new Error("provider down");
        calls.push(`cancel ${ref} ${when}`);
      },
      deleteCustomer: async (id) => void calls.push(`delete ${id}`),
    },
  });
  return { stop, calls };
}

describe("billing stopper", () => {
  it("stops each billing plan now, then removes the customer record", async () => {
    const { stop, calls } = setup([row({ providerRef: "sub_1" }), row({ id: "f", billing: "installments", providerRef: "sub_2" })], "cus_9");
    expect(await stop("user_a")).toEqual({ plansStopped: 2, customerRemoved: true });
    expect(calls).toEqual(["cancel sub_1 now", "cancel sub_2 now", "delete cus_9"]);
  });

  it("leaves alone what does not bill: one-time purchases, grants, plans already ended or never paid", async () => {
    const { stop, calls } = setup(
      [row({ billing: "one_time" }), row({ source: "owner_lifetime" as EntitlementRow["source"] }), row({ status: "revoked" }), row({ providerRef: null }), row({ paidThrough: null })],
      null,
    );
    expect(await stop("user_a")).toEqual({ plansStopped: 0, customerRemoved: false });
    expect(calls).toEqual([]);
  });

  it("throws when the provider fails, so the caller deletes nothing, and removes no customer record first", async () => {
    const { stop, calls } = setup([row({})], "cus_9", true);
    await expect(stop("user_a")).rejects.toThrow("provider down");
    expect(calls).toEqual([]);
  });
});
