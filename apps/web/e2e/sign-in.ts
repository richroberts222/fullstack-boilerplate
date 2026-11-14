import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

// Signs the Clerk DEVELOPMENT test user in without a password: Clerk's testing helper uses the dev secret
// key to create a one-time sign-in for the email address (docs/automation/playwright.md). Never point this
// at production keys; playwright.config.ts refuses anything but dev/qa and Clerk test keys.
// When a sign-up step (terms, age confirmation) is added, extend this helper in the same pull request.
export async function signIn(page: Page, emailAddress: string = process.env.E2E_CLERK_USER_EMAIL!): Promise<void> {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress });
  await page.goto("/");
}
