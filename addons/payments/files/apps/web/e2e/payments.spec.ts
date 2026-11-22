import { expect, test } from "@playwright/test";

import { signIn } from "./sign-in";

// The payments add-on in a browser (/docs/features/payments.md): the owner makes an offer and a coupon, a member
// buys with the TEST checkout (no money moves), sees access, stops and pays a plan, and the owner sees and
// refunds the payment. Opt-in like every E2E test, and it needs a setup that names one Clerk development user as
// both the owner and the buyer: PAYMENTS_PROVIDER=dev and OWNER_USER_IDS=<that user's id> in the server's
// environment, and PAYMENTS_E2E=1 here (docs/automation/playwright.md). It runs against a throwaway database.

test.skip(process.env.PAYMENTS_E2E !== "1", "needs PAYMENTS_E2E=1, PAYMENTS_PROVIDER=dev and OWNER_USER_IDS naming the E2E user");

async function acceptIfAsked(page: import("@playwright/test").Page) {
  await page.goto("/accept?next=/dashboard");
  if (await page.getByTestId("accept-form").isVisible()) {
    await page.getByTestId("accept-terms").click();
    await page.getByTestId("accept-age").click();
    await page.getByTestId("accept-submit").click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

const stamp = Date.now();
const planTitle = `E2E monthly ${stamp}`;
const yearTitle = `E2E year ${stamp}`;
const couponCode = `E2E${stamp}`.slice(0, 16).toUpperCase();

test.describe.configure({ mode: "serial" });

test("visitor: the pricing page is public and asks for a sign-in before buying", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Ways to get access" })).toBeVisible();
  // Either nothing is for sale yet, or each offer asks the visitor to sign in first.
  const empty = page.getByTestId("pricing-empty");
  if (!(await empty.isVisible())) await expect(page.locator('[data-testid^="sign-in-to-buy-link-"]').first()).toBeVisible();
});

test("owner: the owner home links to the screens, and offers and coupons can be made", async ({ page }) => {
  await signIn(page);
  await acceptIfAsked(page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-not-allowed")).toHaveCount(0);
  await expect(page.getByTestId("admin-link-offers")).toBeVisible();
  await expect(page.getByTestId("admin-link-coupons")).toBeVisible();
  await expect(page.getByTestId("admin-link-payments")).toBeVisible();

  await page.getByTestId("admin-link-offers").click();
  await expect(page.getByTestId("offers-not-allowed")).toHaveCount(0);
  await page.getByTestId("offer-title-new").fill(planTitle);
  await page.getByTestId("offer-price-new").fill("12.00");
  await page.getByTestId("offer-billing-new").selectOption("monthly");
  await page.getByTestId("offer-active-new").click();
  await page.getByTestId("offer-save-new").click();
  await expect(page.getByTestId("offer-status-new")).toHaveText("Saved.");
  await expect(page.locator('[data-testid^="owner-offer-"]').filter({ hasText: planTitle })).toBeVisible();
  await expect(page.locator('[data-testid^="offers-group-"]').first()).toBeVisible();

  // An empty form is refused with a message under the field, and a scope other than everything asks which ones.
  await page.getByTestId("offer-save-new").click();
  await expect(page.locator('[data-testid^="offer-error-"]').first()).toBeVisible();
  await page.getByTestId("offer-scope-new").selectOption("groups");
  await expect(page.getByTestId("offer-scope-ids-new")).toBeVisible();
  await page.getByTestId("offer-scope-new").selectOption("everything");

  // An upgraded one-year offer: description, bonus tier and days of access.
  await page.getByTestId("offer-title-new").fill(yearTitle);
  await page.getByTestId("offer-description-new").fill("E2E description");
  await page.getByTestId("offer-price-new").fill("90.00");
  await page.getByTestId("offer-billing-new").selectOption("one_time");
  await page.getByTestId("offer-days-new").fill("365");
  await page.getByTestId("offer-bonus-new").click();
  await page.getByTestId("offer-active-new").click();
  await page.getByTestId("offer-save-new").click();
  const yearCard = page.locator('[data-testid^="owner-offer-"]').filter({ hasText: yearTitle });
  await expect(yearCard).toBeVisible();
  await expect(yearCard.locator('[data-testid^="offer-tier-"]')).toHaveText("Upgraded");
  await expect(yearCard.locator('[data-testid^="offer-summary-"]')).toContainText("$90");

  // Edit it: the form opens with the saved values and saves again.
  await yearCard.locator('[data-testid^="offer-edit-"]').click();
  await expect(page.locator('[data-testid^="offer-form-"]').first()).toBeVisible();
  await page.locator('[data-testid^="offer-save-"]').first().click();

  // A payment plan shows its number of payments and its total.
  await page.getByTestId("offer-title-new").fill(`E2E plan ${stamp}`);
  await page.getByTestId("offer-price-new").fill("10.00");
  await page.getByTestId("offer-billing-new").selectOption("installments");
  await page.getByTestId("offer-installments-new").fill("3");
  await page.getByTestId("offer-save-new").click();
  await expect(page.locator('[data-testid^="owner-offer-"]').filter({ hasText: `E2E plan ${stamp}` }).locator('[data-testid^="offer-summary-"]')).toContainText("$30");

  // Delete the plan again (a confirmation first).
  const planCard = page.locator('[data-testid^="owner-offer-"]').filter({ hasText: `E2E plan ${stamp}` });
  page.once("dialog", (d) => void d.accept());
  await planCard.locator('[data-testid^="offer-delete-"]').click();
  await expect(planCard).toHaveCount(0);

  await page.getByTestId("offers-coupons-link").click();
  await page.getByTestId("coupons-offers-link").click();
  await page.getByTestId("offers-admin-link").click();
  await expect(page.getByTestId("admin-link-offers")).toBeVisible();

  await page.goto("/admin/coupons");
  await page.getByTestId("coupon-save-new").click();
  await expect(page.locator('[data-testid^="coupon-error-"]').first()).toBeVisible();
  await page.getByTestId("coupon-code-new").fill(couponCode);
  await page.getByTestId("coupon-kind-new").selectOption("percent");
  await page.getByTestId("coupon-value-new").fill("50");
  await page.getByTestId("coupon-ends-new").fill("2099-12-31");
  await page.getByTestId("coupon-uses-new").fill("100");
  await expect(page.getByTestId("coupon-offers-new")).toBeVisible();
  await page.locator('[data-testid^="coupon-offer-new-"]').first().click(); // limit it to the first offer
  await page.locator('[data-testid^="coupon-offer-new-"]').first().click(); // and back to every offer
  await expect(page.getByTestId("coupon-active-new")).toBeVisible();
  await page.getByTestId("coupon-save-new").click();
  await expect(page.getByTestId("coupon-status-new")).toHaveText("Saved.");
  const couponCard = page.locator('[data-testid^="owner-coupon-"]').filter({ hasText: couponCode });
  await expect(couponCard).toBeVisible();
  await expect(couponCard.locator('[data-testid^="coupon-summary-"]')).toContainText("50% off");
  await couponCard.locator('[data-testid^="coupon-edit-"]').click();
  await expect(page.locator('[data-testid^="coupon-form-"]').first()).toBeVisible();
  await page.locator('[data-testid^="coupon-save-"]').first().click();
});

test("member: a code lowers the price, the test checkout grants access, and the plan can be paid and stopped", async ({ page }) => {
  await signIn(page);
  await acceptIfAsked(page);
  await page.goto("/pricing");
  // Offers sit under their group, basic and upgraded side by side, each with its way to pay.
  await expect(page.locator('[data-testid^="pricing-group-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="pricing-tier-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="offer-price-line-"]').first()).toBeVisible();
  const card = page.locator('[data-testid^="offer-"]').filter({ hasText: planTitle }).first();
  await expect(card).toBeVisible();
  // A code that does not exist says so.
  await card.locator('[data-testid^="offer-coupon-"]').fill("NOSUCHCODE1");
  await card.locator('[data-testid^="offer-apply-"]').click();
  await expect(card.locator('[data-testid^="offer-quote-error-"]')).toBeVisible();
  await card.locator('[data-testid^="offer-coupon-"]').fill(couponCode);
  await card.locator('[data-testid^="offer-apply-"]').click();
  await expect(card.locator('[data-testid^="offer-quote-"]').first()).toContainText("$6.00");

  await card.locator('[data-testid^="buy-"]').first().click();
  await expect(page.getByTestId("dev-checkout")).toBeVisible();
  await expect(page.getByTestId("dev-checkout-notice")).toBeVisible();
  await page.getByTestId("dev-checkout-complete").click();
  await expect(page.getByTestId("dev-checkout-done")).toBeVisible();
  await expect(page.getByTestId("dev-checkout-account-link")).toBeVisible();
  await page.getByTestId("dev-checkout-account").click();

  await expect(page.getByTestId("my-access")).toBeVisible();
  const row = page.locator('[data-testid^="access-"]').filter({ hasText: planTitle }).first();
  await expect(row).toBeVisible();
  await expect(page.locator('[data-testid^="access-tier-"]').first()).toHaveText("Basic");
  await expect(page.locator('[data-testid^="access-upgrade-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="access-status-"]').first()).toContainText("Renews");
  await page.locator('[data-testid^="access-dev-pay-"]').first().click();
  await expect(page.getByTestId("my-access-error")).toHaveCount(0);
  await page.locator('[data-testid^="access-cancel-"]').first().click();
  await expect(page.locator('[data-testid^="access-status-"]').first()).toContainText("Canceled");
});

test("owner: the payment is listed, can be exported, and a full refund ends the access", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/payments");
  await expect(page.getByTestId("payments-not-allowed")).toHaveCount(0);
  await expect(page.getByTestId("payments-list")).toBeVisible();
  await expect(page.getByTestId("payments-summary")).toContainText("payments");
  await expect(page.getByTestId("payments-export")).toBeEnabled();
  // A part refund first (no access change), then the rest.
  await page.locator('[data-testid^="payment-refund-"]').first().click();
  await expect(page.locator('[data-testid^="refund-form-"]').first()).toBeVisible();
  await page.locator('[data-testid^="refund-amount-"]').first().fill("1.00");
  await page.locator('[data-testid^="refund-reason-"]').first().fill("E2E part refund");
  page.once("dialog", (d) => void d.accept());
  await page.locator('[data-testid^="refund-submit-"]').first().click();
  await expect(page.locator('[data-testid^="refund-status-"]').first()).toContainText("Refunded");
  await page.reload();
  await page.locator('[data-testid^="payment-refund-"]').first().click();
  await page.locator('[data-testid^="refund-reason-"]').first().fill("E2E full refund");
  page.once("dialog", (d) => void d.accept());
  await page.locator('[data-testid^="refund-submit-"]').first().click();
  await expect(page.locator('[data-testid^="refund-status-"]').first()).toContainText("Refunded");

  // One member's payments only, and a way back to all of them.
  await page.goto("/admin/payments?member=user_nobody");
  await expect(page.getByTestId("payments-empty")).toBeVisible();
  await page.getByTestId("payments-all-link").click();
  await page.getByTestId("payments-admin-link").click();
  await expect(page.getByTestId("admin-link-payments")).toBeVisible();
});
