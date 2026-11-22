import type { DiscountKind } from "@app-boilerplate/validation";
import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { coupons, memberDiscounts } from "./addons/payments";

// Pricing data access (/docs/database.md section 8): coupons and scholarship amounts. The only code
// that queries these tables. Writes that must happen with others are returned as statements.

type Statement = Parameters<Database["batch"]>[0][number];

export type CouponRow = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  offerIds: string[];
  endsAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
};
export type CouponPatch = Omit<CouponRow, "id" | "code" | "usedCount">;

export type DiscountRow = {
  id: string;
  userId: string;
  kind: DiscountKind;
  value: number;
  offerIds: string[];
  endsAt: Date | null;
  reason: string;
  grantedBy: string;
  status: "active" | "revoked";
};

export type PricingRepo = {
  listCoupons(): Promise<CouponRow[]>;
  findCoupon(id: string): Promise<CouponRow | null>;
  findCouponByCode(code: string): Promise<CouponRow | null>;
  insertCouponStatement(row: CouponRow): Statement;
  updateCouponStatement(id: string, patch: CouponPatch): Statement;
  /** Counts one use; part of the purchase's atomic unit. */
  useCouponStatement(id: string): Statement;
  listDiscountsForUser(userId: string): Promise<DiscountRow[]>;
  findDiscount(id: string): Promise<DiscountRow | null>;
  insertDiscountStatement(row: DiscountRow): Statement;
  revokeDiscountStatement(id: string, reason: string): Statement;
};

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

const couponCols = {
  id: coupons.id,
  code: coupons.code,
  kind: coupons.kind,
  value: coupons.value,
  offerIds: coupons.offerIds,
  endsAt: coupons.endsAt,
  maxUses: coupons.maxUses,
  usedCount: coupons.usedCount,
  isActive: coupons.isActive,
};
const discountCols = {
  id: memberDiscounts.id,
  userId: memberDiscounts.userId,
  kind: memberDiscounts.kind,
  value: memberDiscounts.value,
  offerIds: memberDiscounts.offerIds,
  endsAt: memberDiscounts.endsAt,
  reason: memberDiscounts.reason,
  grantedBy: memberDiscounts.grantedBy,
  status: memberDiscounts.status,
};
const toCoupon = (r: { [K in keyof typeof couponCols]: unknown }): CouponRow => ({ ...(r as CouponRow), offerIds: ids(r.offerIds) });
const toDiscount = (r: { [K in keyof typeof discountCols]: unknown }): DiscountRow => ({ ...(r as DiscountRow), offerIds: ids(r.offerIds) });

export function createPricingRepo(db: Database): PricingRepo {
  const firstCoupon = (operation: string, rows: Promise<{ [K in keyof typeof couponCols]: unknown }[]>) =>
    withDbErrors(operation, async () => {
      const row = (await rows)[0];
      return row ? toCoupon(row) : null;
    });
  return {
    listCoupons: () => withDbErrors("pricing.listCoupons", async () => (await db.select(couponCols).from(coupons).orderBy(asc(coupons.code))).map(toCoupon)),
    findCoupon: (id) => firstCoupon("pricing.findCoupon", db.select(couponCols).from(coupons).where(eq(coupons.id, id)).limit(1)),
    findCouponByCode: (code) => firstCoupon("pricing.findCouponByCode", db.select(couponCols).from(coupons).where(eq(coupons.code, code)).limit(1)),
    insertCouponStatement: (row) => db.insert(coupons).values(row),
    updateCouponStatement: (id, patch) => db.update(coupons).set({ ...patch, updatedAt: sql`now()` }).where(eq(coupons.id, id)),
    useCouponStatement: (id) => db.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1`, updatedAt: sql`now()` }).where(eq(coupons.id, id)),
    listDiscountsForUser: (userId) =>
      withDbErrors("pricing.listDiscountsForUser", async () =>
        (await db.select(discountCols).from(memberDiscounts).where(eq(memberDiscounts.userId, userId)).orderBy(asc(memberDiscounts.createdAt))).map(toDiscount),
      ),
    findDiscount: (id) =>
      withDbErrors("pricing.findDiscount", async () => {
        const row = (await db.select(discountCols).from(memberDiscounts).where(eq(memberDiscounts.id, id)).limit(1))[0];
        return row ? toDiscount(row) : null;
      }),
    insertDiscountStatement: (row) => db.insert(memberDiscounts).values(row),
    revokeDiscountStatement: (id, reason) => db.update(memberDiscounts).set({ status: "revoked", reason, updatedAt: sql`now()` }).where(eq(memberDiscounts.id, id)),
  };
}
