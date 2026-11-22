import { describe, expect, it } from "vitest";

import { parsePaymentsEnv, PaymentsEnvError } from "./payments-env";

const KEY = "sk_test_" + "A".repeat(24);
const LIVE = "sk_live_" + "A".repeat(24);

describe("payments environment guard", () => {
  it("defaults to purchases closed with nobody as owner", () => {
    expect(parsePaymentsEnv({})).toEqual({ paymentsProvider: "none", stripeSecretKey: "", stripeWebhookSecret: "", ownerUserIds: [], cronSecret: "" });
  });

  it("refuses the free test checkout in production, by any production signal", () => {
    for (const env of [{ APP_ENV: "prod" }, { DATABASE_ENV: "prod" }, { VERCEL_ENV: "production" }]) {
      expect(() => parsePaymentsEnv({ PAYMENTS_PROVIDER: "dev", ...env })).toThrow(PaymentsEnvError);
    }
    expect(parsePaymentsEnv({ PAYMENTS_PROVIDER: "dev", APP_ENV: "dev" }).paymentsProvider).toBe("dev");
  });

  it("keeps live Stripe keys to production and test keys out of it", () => {
    expect(() => parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: LIVE, APP_ENV: "dev" })).toThrow(/live Stripe key/);
    expect(() => parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: KEY, APP_ENV: "prod" })).toThrow(/test key/);
    expect(parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: LIVE, APP_ENV: "prod" }).stripeSecretKey).toBe(LIVE);
    expect(parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: KEY, APP_ENV: "dev" }).stripeSecretKey).toBe(KEY);
  });

  it("refuses a missing or malformed Stripe key and webhook secret, and never echoes them", () => {
    expect(() => parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe" })).toThrow(/STRIPE_SECRET_KEY/);
    try {
      parsePaymentsEnv({ PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: "not-a-secret" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain("not-a-secret");
      expect((e as Error).message).toContain("STRIPE_WEBHOOK_SECRET");
    }
  });

  it("reads the owner list and refuses a malformed one; a short cron secret is refused", () => {
    expect(parsePaymentsEnv({ OWNER_USER_IDS: "user_abc, user_def" }).ownerUserIds).toEqual(["user_abc", "user_def"]);
    expect(() => parsePaymentsEnv({ OWNER_USER_IDS: "someone" })).toThrow(/OWNER_USER_IDS/);
    expect(() => parsePaymentsEnv({ CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
  });
});
