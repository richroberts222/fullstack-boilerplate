import { formatPrice } from "@app-boilerplate/validation";

// Pure helpers for the owner's offers and coupons screens (S6). Display and form parsing only: every
// price and discount is computed on the server.

/** "29", "29.5", "$29.50" to cents; anything else is NaN so the server refuses it with a message. */
export const toCents = (price: string): number => {
  const m = /^\s*\$?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(price);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : Number.NaN;
};

type Groupable = { scope: "everything" | "groups" | "parts"; scopeIds: string[] };

/** Groups offers by what they unlock: each chosen group's title, "Everything", or "Chosen parts". */
export function groupOffers<T extends Groupable>(offers: T[], known: { id: string; title: string }[]): { name: string; offers: T[] }[] {
  const names = new Map(known.map((c) => [c.id, c.title]));
  const groups = new Map<string, T[]>();
  for (const o of offers) {
    const name =
      o.scope === "everything" ? "Everything" : o.scope === "parts" ? "Chosen parts" : o.scopeIds.map((id) => names.get(id) ?? "Removed group").join(" + ") || "No group chosen";
    groups.set(name, [...(groups.get(name) ?? []), o]);
  }
  return [...groups].map(([name, list]) => ({ name, offers: list }));
}

/** What a payment plan costs in all, in cents; any other offer is its price. */
export const planTotalCents = (o: { billing: "one_time" | "monthly" | "installments"; priceCents: number; installmentCount: number }): number =>
  o.billing === "installments" ? o.priceCents * o.installmentCount : o.priceCents;

/** What a coupon does, in words: "25% off" or "$10.00 off". */
export const describeCoupon = (c: { kind: "percent" | "amount"; value: number }): string => (c.kind === "percent" ? `${c.value}% off` : `${formatPrice(c.value)} off`);
