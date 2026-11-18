import "server-only";

import { MINIMUM_AGE } from "@app-boilerplate/validation";

import { getDb } from "../../db";
import { createLegalRepo } from "../../db/legal";
import { createClerkAccounts } from "../auth/clerk-accounts";
import { accountDataParts } from "../legal/account-data";
import { createAtomicRunner } from "../services/atomic";
import { createPrivacyService, type PrivacyService } from "../services/privacy";

// Legal add-on wiring (/docs/features/legal-gate.md), kept apart from lib/composition.ts so the add-on
// never edits the base composition root. Lazy, like every getter there.

let privacy: PrivacyService | undefined;

export function getPrivacyService(): PrivacyService {
  return (privacy ??= createPrivacyService({
    repo: createLegalRepo(getDb()),
    parts: accountDataParts(getDb()),
    accounts: createClerkAccounts(),
    atomic: createAtomicRunner(getDb()),
    minimumAge: MINIMUM_AGE,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }));
}
