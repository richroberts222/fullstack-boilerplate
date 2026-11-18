import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./sign-in";

// The legal gate in a browser (/docs/features/legal-gate.md). Opt-in like every E2E test: it needs the E2E
// secrets. The delete test stops before deleting: the shared test user must survive.

async function acceptIfAsked(page: Page) {
  await page.goto("/accept?next=/dashboard");
  if (await page.getByTestId("accept-form").isVisible()) {
    await page.getByTestId("accept-terms").click();
    await page.getByTestId("accept-age").click();
    await page.getByTestId("accept-submit").click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

test("visitor: the Terms and Privacy pages are public, marked as drafts, and link to each other", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByTestId("terms-draft")).toBeVisible();
  await expect(page.getByTestId("terms-version")).toBeVisible();
  await page.getByTestId("terms-privacy-link").click();
  await expect(page.getByTestId("privacy-draft")).toBeVisible();
  await expect(page.getByTestId("privacy-version")).toBeVisible();
});

test("member: the accept page needs both boxes and links the documents", async ({ page }) => {
  await signIn(page);
  await page.goto("/accept?next=/dashboard");
  if (await page.getByTestId("accept-form").isVisible()) {
    await expect(page.getByTestId("accept-terms-link")).toHaveAttribute("href", "/terms");
    await expect(page.getByTestId("accept-privacy-link")).toHaveAttribute("href", "/privacy");
    await expect(page.getByTestId("accept-submit")).toBeDisabled();
    await page.getByTestId("accept-terms").click();
    await expect(page.getByTestId("accept-submit")).toBeDisabled();
    await page.getByTestId("accept-age").click();
    await page.getByTestId("accept-submit").click();
    await expect(page.getByTestId("accept-error")).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/dashboard/);
});

test("member: download my data gives a JSON file; delete stays locked until DELETE is typed", async ({ page }) => {
  await signIn(page);
  await acceptIfAsked(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("my-data-export").click();
  expect((await download).suggestedFilename()).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByTestId("my-data-error")).toHaveCount(0);
  await expect(page.getByTestId("my-data")).toBeVisible();
  await expect(page.getByTestId("my-data-delete-form")).toBeVisible();
  await page.getByTestId("my-data-delete-confirm").fill("nope");
  await expect(page.getByTestId("my-data-delete")).toBeDisabled();
});
