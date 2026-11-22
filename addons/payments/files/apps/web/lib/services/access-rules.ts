import type { EntitlementRow } from "../../db/access";

// The access rules, as pure functions (/docs/features/access-and-checkout.md, /docs/features/grace-period.md).
// No database, no clock of their own: every caller passes `now`, so each rule is tested at exact moments.

export const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessState = "active" | "grace" | "ended";

/** The grace period applies only when a member was paying over time and the payments stopped. */
export function hasGracePeriod(e: Pick<EntitlementRow, "source" | "billing">): boolean {
  return e.source === "purchase" && (e.billing === "monthly" || e.billing === "installments");
}

/** When the grace period ends (or null when there is no end date or no grace period). */
export function graceEndsAt(e: Pick<EntitlementRow, "source" | "billing" | "paidThrough">, graceDays: number): Date | null {
  if (e.paidThrough === null || !hasGracePeriod(e)) return null;
  return new Date(e.paidThrough.getTime() + graceDays * DAY_MS);
}

/**
 * Where an entitlement stands at `now`:
 * - active: paid (or granted) and not past its end date;
 * - grace:  a paid plan past its paid date but inside the grace period (full access continues);
 * - ended:  revoked, or past its end date and any grace period.
 */
export function accessState(e: Pick<EntitlementRow, "source" | "billing" | "paidThrough" | "status">, now: Date, graceDays: number): AccessState {
  if (e.status === "revoked") return "ended";
  if (e.paidThrough === null || now < e.paidThrough) return "active";
  const graceEnd = graceEndsAt(e, graceDays);
  return graceEnd !== null && now < graceEnd ? "grace" : "ended";
}

/** Whether an entitlement unlocks a part (which belongs to a group). */
export function covers(e: Pick<EntitlementRow, "scope" | "scopeIds">, target: { partId: string; groupId: string }): boolean {
  if (e.scope === "everything") return true;
  if (e.scope === "groups") return e.scopeIds.includes(target.groupId);
  return e.scopeIds.includes(target.partId);
}

/** Whether an entitlement unlocks the bonus content attached to a part (which belongs to a group). */
export function coversBonus(e: Pick<EntitlementRow, "scope" | "scopeIds" | "includesBonus">, target: { partId: string; groupId: string }): boolean {
  return e.includesBonus && covers(e, target);
}

/**
 * One calendar month later, in UTC. A day that the next month lacks becomes that month's last day
 * (January 31 becomes February 28 or 29), so a monthly plan never skips a month.
 */
export function addMonth(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const lastDayNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const out = new Date(d.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(m + 1);
  out.setUTCDate(Math.min(d.getUTCDate(), lastDayNext));
  return out;
}
