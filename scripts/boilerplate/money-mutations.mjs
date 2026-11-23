// Money mutation check for the payments add-on (O12, 2026-11-22). Breaks one money rule at a time in a
// generated application, runs the test file that should protect it, and expects that test to FAIL; then
// restores the file. A rule whose break SURVIVES has no test that can fail for it.
//
//   node scripts/boilerplate/prove-init.mjs --full --keep        # prints "kept: <dir>"
//   node scripts/boilerplate/money-mutations.mjs <dir> [name filter ...]
//
// Run it after changing anything under addons/payments that touches prices, access, payments or the webhook,
// and add a line here for every new money rule. Exit code 1 when any break survives or any target text is
// missing (the code moved: update the line).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [dir, ...filters] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: node scripts/boilerplate/money-mutations.mjs <generated app dir> [name filter ...]");
  process.exit(2);
}
const app = path.join(dir, "apps", "web");
const ACCESS = "lib/services/access.test.ts";

// [name, file, exact text, replacement, test file]
const BREAKS = [
  ["pricing: percent rounds to nearest cent", "lib/services/pricing.ts", "Math.round((cents * value) / 100)", "Math.floor((cents * value) / 100)", ACCESS],
  ["pricing: discount capped at the price", "lib/services/pricing.ts", "return Math.max(0, Math.min(cents, off));", "return Math.max(0, off);", ACCESS],
  ["pricing: coupon applies after scholarship", "lib/services/pricing.ts", "reduction(coupon!.kind, coupon!.value, list - scholarshipCents)", "reduction(coupon!.kind, coupon!.value, list)", ACCESS],
  ["pricing: largest scholarship, not the sum", "lib/services/pricing.ts", "(best, d) => Math.max(best, reduction(d.kind, d.value, list))", "(best, d) => best + reduction(d.kind, d.value, list)", ACCESS],
  ["pricing: used-up code refused", "lib/services/pricing.ts", "(c.maxUses !== null && c.usedCount >= c.maxUses) || ", "", ACCESS],
  ["pricing: code for another offer refused", "lib/services/pricing.ts", " || !appliesTo(c, offerId)) return", ") return", ACCESS],
  ["pricing: ended code refused", "lib/services/pricing.ts", "!c.isActive || !notEnded(c.endsAt, now) ||", "!c.isActive ||", ACCESS],
  ["access: bonus needs the upgraded tier", "lib/services/access-rules.ts", "return e.includesBonus && covers(e, target);", "return covers(e, target);", ACCESS],
  ["access: grace period ends", "lib/services/access-rules.ts", 'return graceEnd !== null && now < graceEnd ? "grace" : "ended";', 'return graceEnd !== null ? "grace" : "ended";', ACCESS],
  ["access: one-time purchase has no grace", "lib/services/access-rules.ts", 'return e.source === "purchase" && (e.billing === "monthly" || e.billing === "installments");', 'return e.source === "purchase";', ACCESS],
  ["access: revoked ends access", "lib/services/access-rules.ts", 'if (e.status === "revoked") return "ended";', "", ACCESS],
  ["access: group scope covers only its groups", "lib/services/access-rules.ts", 'if (e.scope === "groups") return e.scopeIds.includes(target.groupId);', 'if (e.scope === "groups") return true;', ACCESS],
  ["webhook: signature compared", "lib/payments/stripe.ts", 'return timingSafeEqual(Buffer.from(s, "hex"), expected);', "return true;", "lib/payments/stripe.test.ts"],
  ["webhook: old signature refused", "lib/payments/stripe.ts", "if (Math.abs(now.getTime() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;", "", "lib/payments/stripe.test.ts"],
  ["webhook: empty secret refuses all", "lib/payments/stripe.ts", 'if (!header || secret === "") return false;', "if (!header) return false;", "lib/payments/stripe.test.ts"],
  ["repeat: renewal counted once", "lib/services/access.ts", "if (await repo.findPayment(payment.provider, payment.providerPaymentId)) return { recorded: false, owned: e.paidThrough === null };", "", ACCESS],
  ["repeat: completed session not granted twice", "lib/services/access.ts", 'if (session.status === "completed") return { entitlementId: null };', "", ACCESS],
  ["out of order: late renewal extends from paid date", "lib/services/access.ts", "const base = e.paidThrough > payment.paidAt ? e.paidThrough : payment.paidAt;", "const base = payment.paidAt;", ACCESS],
  ["underpayment grants nothing", "lib/services/access.ts", 'if (!trial && payment.amountCents < price) throw conflict("The payment does not match the price.");', "", ACCESS],
  ["refund: total never lowered by a late notice", "lib/services/access.ts", "Math.min(payment.amountCents, Math.max(payment.refundedCents, refundedTotal))", "Math.min(payment.amountCents, refundedTotal)", ACCESS],
  ["refund: full refund ends access", "lib/services/access.ts", 'const ends = reason === "dispute" || (payment.amountCents > 0 && total >= payment.amountCents);', 'const ends = reason === "dispute";', ACCESS],
  ["dispute ends access", "lib/services/access.ts", 'const ends = reason === "dispute" || (', "const ends = (", ACCESS],
  ["installments owned at last payment", "lib/services/access.ts", 'const owned = e.billing === "installments" && installmentsPaid >= e.installmentCount;', "const owned = false;", ACCESS],
  ["coupon use counted with the purchase", "lib/services/access.ts", "const couponUse = session.couponId ? [deps.pricing.useCouponStatement(session.couponId)] : [];", "const couponUse: never[] = [];", ACCESS],
  ["billing-stop: plans are stopped", "lib/services/billing-stop.ts", 'for (const e of billing) await deps.payments.cancel(e.providerRef!, "now");', "", "lib/services/billing-stop.test.ts"],
  ["billing-stop: customer is deleted", "lib/services/billing-stop.ts", "if (customerId) await deps.payments.deleteCustomer(customerId);", "", "lib/services/billing-stop.test.ts"],
  ["billing-stop: one-time purchases left alone", "lib/services/billing-stop.ts", ' && e.billing !== "one_time"', "", "lib/services/billing-stop.test.ts"],
  ["payments-read: owner only", "lib/services/payments-read.ts", "await authorize(ctx.actor, deps.isSiteOwner, undefined);", "", "lib/services/payments-read.test.ts"],
];

let bad = 0;
for (const [name, file, from, to, test] of BREAKS) {
  if (filters.length && !filters.some((f) => name.includes(f))) continue;
  const p = path.join(app, file);
  const original = readFileSync(p, "utf8");
  if (!original.includes(from)) {
    bad++;
    console.log(`MISSING  ${name} (${file})`);
    continue;
  }
  writeFileSync(p, original.replace(from, to));
  try {
    const r = spawnSync(`pnpm exec vitest run ${test}`, { cwd: app, encoding: "utf8", shell: true });
    if (r.status === 0) bad++;
    console.log(`${r.status === 0 ? "SURVIVED" : "CAUGHT  "} ${name}`);
  } finally {
    writeFileSync(p, original);
  }
}
console.log(bad === 0 ? "All money breaks caught." : `${bad} problem(s): see SURVIVED or MISSING above.`);
process.exit(bad === 0 ? 0 : 1);
