// The payments add-on's environment guard (/docs/environment.md, /docs/features/payments.md). A pure function over
// an env-like object, so it is unit-tested; `lib/addons/payments.ts` calls it once with process.env.
//
//   PAYMENTS_PROVIDER   none (default: purchases closed) | dev (a test checkout that charges nothing) | stripe
//   STRIPE_SECRET_KEY   sk_test_... outside prod, sk_live_... only in prod (provider stripe only)
//   STRIPE_WEBHOOK_SECRET   whsec_... (empty means the webhook refuses every call)
//   OWNER_USER_IDS      comma-separated Clerk user ids allowed to run the site; empty means nobody
//   CRON_SECRET         at least 32 characters; empty means scheduled jobs refuse to run

export type PaymentsEnv = {
  paymentsProvider: "none" | "dev" | "stripe";
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  ownerUserIds: readonly string[];
  cronSecret: string;
};

export class PaymentsEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid payments configuration: ${issues.join(" ")}`);
    this.name = "PaymentsEnvError";
  }
}

type Source = Record<string, string | undefined>;

export function parsePaymentsEnv(source: Source): PaymentsEnv {
  const issues: string[] = [];
  const isProd = source.APP_ENV === "prod" || source.DATABASE_ENV === "prod" || source.VERCEL_ENV === "production";

  const raw = (source.PAYMENTS_PROVIDER ?? "").trim() === "" ? "none" : source.PAYMENTS_PROVIDER!.trim();
  let paymentsProvider: PaymentsEnv["paymentsProvider"] = "none";
  if (raw !== "none" && raw !== "dev" && raw !== "stripe") issues.push("PAYMENTS_PROVIDER must be 'none', 'dev' or 'stripe'.");
  else if (raw === "dev" && isProd) issues.push("PAYMENTS_PROVIDER 'dev' (the test checkout) is not allowed in production.");
  else paymentsProvider = raw;

  const stripeSecretKey = paymentsProvider === "stripe" ? (source.STRIPE_SECRET_KEY ?? "").trim() : "";
  const stripeWebhookSecret = paymentsProvider === "stripe" ? (source.STRIPE_WEBHOOK_SECRET ?? "").trim() : "";
  if (paymentsProvider === "stripe") {
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(stripeSecretKey)) issues.push("STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_... or sk_live_...) when PAYMENTS_PROVIDER is 'stripe'.");
    // Live keys move real money: prod only. Test keys never in prod, where buyers would get access free.
    else if (stripeSecretKey.startsWith("sk_live_") && !isProd) issues.push("A live Stripe key is not allowed outside the prod environment.");
    else if (stripeSecretKey.startsWith("sk_test_") && isProd) issues.push("A Stripe test key is not allowed in the prod environment.");
    if (stripeWebhookSecret !== "" && !/^whsec_[A-Za-z0-9]+$/.test(stripeWebhookSecret)) issues.push("STRIPE_WEBHOOK_SECRET must look like whsec_....");
  }

  let ownerUserIds: string[] = [];
  const rawOwners = (source.OWNER_USER_IDS ?? "").trim();
  if (rawOwners !== "") {
    const ids = rawOwners.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (ids.some((id) => !/^user_[A-Za-z0-9]+$/.test(id))) issues.push("OWNER_USER_IDS must be a comma-separated list of Clerk user ids (user_...).");
    else ownerUserIds = ids;
  }

  const cronSecret = (source.CRON_SECRET ?? "").trim();
  if (cronSecret !== "" && cronSecret.length < 32) issues.push("CRON_SECRET must be at least 32 characters.");

  if (issues.length > 0) throw new PaymentsEnvError(issues);
  return { paymentsProvider, stripeSecretKey, stripeWebhookSecret, ownerUserIds, cronSecret };
}
