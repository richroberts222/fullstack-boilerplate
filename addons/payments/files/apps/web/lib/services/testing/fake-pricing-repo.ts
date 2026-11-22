import type { CouponRow, DiscountRow, PricingRepo } from "../../../db/pricing";

// In-memory pricing repository for service tests. Statements are functions run by the test's fake
// atomic runner, like the access fake.

export function createFakePricingRepo() {
  const data = { coupons: new Map<string, CouponRow>(), discounts: new Map<string, DiscountRow>() };
  const stmt = (fn: () => void) => fn as never;
  const repo: PricingRepo = {
    listCoupons: async () => [...data.coupons.values()].map((c) => ({ ...c })),
    findCoupon: async (id) => (data.coupons.has(id) ? { ...data.coupons.get(id)! } : null),
    findCouponByCode: async (code) => [...data.coupons.values()].find((c) => c.code === code) ?? null,
    insertCouponStatement: (row) => stmt(() => data.coupons.set(row.id, { ...row })),
    updateCouponStatement: (id, patch) => stmt(() => data.coupons.set(id, { ...data.coupons.get(id)!, ...patch })),
    useCouponStatement: (id) =>
      stmt(() => {
        const c = data.coupons.get(id)!;
        data.coupons.set(id, { ...c, usedCount: c.usedCount + 1 });
      }),
    listDiscountsForUser: async (userId) => [...data.discounts.values()].filter((d) => d.userId === userId).map((d) => ({ ...d })),
    findDiscount: async (id) => (data.discounts.has(id) ? { ...data.discounts.get(id)! } : null),
    insertDiscountStatement: (row) => stmt(() => data.discounts.set(row.id, { ...row })),
    revokeDiscountStatement: (id, reason) => stmt(() => data.discounts.set(id, { ...data.discounts.get(id)!, status: "revoked", reason })),
  };
  return { repo, data };
}
