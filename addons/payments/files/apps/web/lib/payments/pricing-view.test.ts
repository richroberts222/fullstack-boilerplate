import { describe, expect, it } from "vitest";

import { describeCoupon, groupOffers, planTotalCents, toCents } from "./pricing-view";

describe("owner pricing screens: display helpers", () => {
  it("reads dollars as cents and refuses junk", () => {
    expect(toCents("29")).toBe(2900);
    expect(toCents("$29.5")).toBe(2950);
    expect(toCents("29.05")).toBe(2905);
    expect(toCents("abc")).toBeNaN();
    expect(toCents("1.234")).toBeNaN();
  });

  it("totals a payment plan as price times payments, and any other offer as its price", () => {
    expect(planTotalCents({ billing: "installments", priceCents: 4000, installmentCount: 3 })).toBe(12000);
    expect(planTotalCents({ billing: "monthly", priceCents: 4000, installmentCount: 3 })).toBe(4000);
  });

  it("groups offers under their group, or everything", () => {
    const known = [
      { id: "c1", title: "Group A" },
      { id: "c2", title: "Group B" },
    ];
    const offers = [
      { id: "a", scope: "groups" as const, scopeIds: ["c1"] },
      { id: "b", scope: "groups" as const, scopeIds: ["c1"] },
      { id: "c", scope: "everything" as const, scopeIds: [] },
      { id: "d", scope: "groups" as const, scopeIds: ["gone"] },
    ];
    const result = groupOffers(offers, known);
    expect(result.map((g) => g.name)).toEqual(["Group A", "Everything", "Removed group"]);
    expect(result[0]?.offers.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("describes a coupon in words", () => {
    expect(describeCoupon({ kind: "percent", value: 25 })).toBe("25% off");
    expect(describeCoupon({ kind: "amount", value: 1000 })).toBe("$10 off");
    expect(describeCoupon({ kind: "amount", value: 1050 })).toBe("$10.50 off");
  });
});
