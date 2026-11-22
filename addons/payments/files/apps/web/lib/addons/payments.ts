import "server-only";

import { randomBytes } from "node:crypto";

import { getDb } from "../../db";
import { createAccessRepo } from "../../db/access";
import { createPricingRepo } from "../../db/pricing";
import { createAuditRepo, createSettingsRepo } from "../../db/settings";
import { inAllowList } from "../auth/site-owner";
import { createClerkAccounts } from "../auth/clerk-accounts";
import { createLogNotices } from "../notices/ports";
import { createClosedPayments, createDevPayments, type PaymentsPort } from "../payments/ports";
import { createAccessService, type AccessService } from "../services/access";
import { createAtomicRunner } from "../services/atomic";
import { createPaymentsSettingsService, type PaymentsSettingsService } from "../services/payments-settings";
import { createPricingService, type PricingService } from "../services/pricing";
import { getPrivacyService } from "./legal";
import { parsePaymentsEnv, type PaymentsEnv } from "./payments-env";
import { scopeCatalog } from "./payments-scopes";

// Payments add-on wiring (/docs/features/payments.md), kept apart from lib/composition.ts so the add-on never
// edits the base composition root. Lazy, like every getter there.

let env: PaymentsEnv | undefined;
export function getPaymentsEnv(): PaymentsEnv {
  return (env ??= parsePaymentsEnv(process.env));
}

const isSiteOwner = () => inAllowList(getPaymentsEnv().ownerUserIds);

function createPayments(): PaymentsPort {
  const { paymentsProvider } = getPaymentsEnv();
  if (paymentsProvider === "stripe") throw new Error("PAYMENTS_PROVIDER 'stripe' needs the Stripe adapter, which the payments add-on gets in its Stripe step (S15).");
  return paymentsProvider === "dev" ? createDevPayments() : createClosedPayments();
}

let settings: PaymentsSettingsService | undefined;
export function getPaymentsSettingsService(): PaymentsSettingsService {
  return (settings ??= createPaymentsSettingsService({
    settings: createSettingsRepo(getDb()),
    audit: createAuditRepo(getDb()),
    atomic: createAtomicRunner(getDb()),
    isSiteOwner: isSiteOwner(),
    newId: () => crypto.randomUUID(),
  }));
}

let pricing: PricingService | undefined;
export function getPricingService(): PricingService {
  return (pricing ??= createPricingService({
    repo: createPricingRepo(getDb()),
    audit: createAuditRepo(getDb()),
    atomic: createAtomicRunner(getDb()),
    isSiteOwner: isSiteOwner(),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }));
}

let access: AccessService | undefined;
export function getAccessService(): AccessService {
  return (access ??= createAccessService({
    repo: createAccessRepo(getDb()),
    scopes: scopeCatalog,
    audit: createAuditRepo(getDb()),
    atomic: createAtomicRunner(getDb()),
    payments: createPayments(),
    pricing: getPricingService(),
    notices: createLogNotices(),
    isSiteOwner: isSiteOwner(),
    graceSettings: async () => {
      const s = await getPaymentsSettingsService().getSettings();
      return { gracePeriodDays: s.gracePeriodDays, reminderSnoozeDays: s.reminderSnoozeDays };
    },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    // 32 random bytes as URL-safe text: unguessable, so a checkout link cannot be found by trying.
    newToken: () => randomBytes(32).toString("base64url"),
    hasAcceptedTerms: (userId) => getPrivacyService().hasAccepted(userId),
    memberEmail: async (userId) => (await createClerkAccounts().getProfile(userId))?.email ?? null,
    billingSettings: async () => ({ trialDays: (await getPaymentsSettingsService().getSettings()).trialDays }),
  }));
}
