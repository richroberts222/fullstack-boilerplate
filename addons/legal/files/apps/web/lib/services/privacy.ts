import { DELETE_CONFIRMATION, PRIVACY_VERSION, TERMS_VERSION, type AcceptLegalInput, type DeleteAccountInput } from "@app-boilerplate/validation";

import type { AccountDataPart, LegalRepo } from "../../db/legal";
import type { AtomicRunner } from "./atomic";
import type { ServiceContext } from "./context";
import { validationFailed } from "./errors";

// The legal gate (/docs/features/legal-gate.md, legal add-on): accepting the Terms and Privacy Policy with
// an age confirmation, downloading one's own data, and deleting one's own account. A member acts only on
// their own data: every method takes the identity from the trusted context, never from input.

/** The identity provider's side of a member (Clerk), behind a port so the service is tested with a fake. */
export type AccountsPort = {
  getProfile(userId: string): Promise<{ name: string; email: string | null; createdAt: Date | null } | null>;
  /** Removes the sign-in account itself. Called last, after the application's own data is gone. */
  deleteAccount(userId: string): Promise<void>;
};

export type PrivacyDeps = {
  repo: LegalRepo;
  /** Every feature's share of a member's data (lib/legal/account-data.ts). */
  parts: AccountDataPart[];
  accounts: AccountsPort;
  atomic: AtomicRunner;
  minimumAge: number;
  now: () => Date;
  newId: () => string;
};

export type LegalStatus = { accepted: boolean; termsVersion: string; privacyVersion: string; minimumAge: number };
export type MyDataFile = { filename: string; json: string };

export function createPrivacyService(deps: PrivacyDeps) {
  async function hasAccepted(userId: string): Promise<boolean> {
    const row = await deps.repo.latestAcceptance(userId);
    return row !== null && row.termsVersion === TERMS_VERSION && row.privacyVersion === PRIVACY_VERSION;
  }

  return {
    /** Whether this member accepted the wording in force (AC2). A newer version asks them again. */
    hasAccepted,

    async getStatus(ctx: ServiceContext): Promise<LegalStatus> {
      return { accepted: await hasAccepted(ctx.actor.userId), termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, minimumAge: deps.minimumAge };
    },

    /** Records the acceptance with the versions, the minimum age confirmed and the time (AC1, AC3). */
    async accept(ctx: ServiceContext, _input: AcceptLegalInput): Promise<void> {
      if (await hasAccepted(ctx.actor.userId)) return;
      await deps.repo.insertAcceptance({ id: deps.newId(), userId: ctx.actor.userId, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, minimumAge: deps.minimumAge, acceptedAt: deps.now() });
    },

    /** Everything held about the caller, as one JSON file (AC5): their profile and every part's rows, only their own. */
    async exportMyData(ctx: ServiceContext): Promise<MyDataFile> {
      const userId = ctx.actor.userId;
      const [profile, ...sections] = await Promise.all([deps.accounts.getProfile(userId), ...deps.parts.map((p) => p.exportFor(userId))]);
      const body: Record<string, unknown> = { exportedAt: deps.now().toISOString(), account: profile ? { userId, ...profile } : { userId } };
      deps.parts.forEach((p, i) => (body[p.name] = sections[i]));
      return { filename: `my-data-${deps.now().toISOString().slice(0, 10)}.json`, json: JSON.stringify(body, null, 2) };
    },

    /**
     * Deletes the caller's account (AC6 to AC8). Each part's preparation runs first (for example, stopping a
     * plan that still bills); if one fails, nothing is deleted. Then every part's rows go in one atomic unit,
     * then the sign-in account.
     */
    async deleteMyAccount(ctx: ServiceContext, input: DeleteAccountInput): Promise<void> {
      if (input.confirm.trim().toUpperCase() !== DELETE_CONFIRMATION) throw validationFailed(`Type ${DELETE_CONFIRMATION} to confirm`, { confirm: [`Type ${DELETE_CONFIRMATION} to confirm`] });
      const userId = ctx.actor.userId;
      for (const p of deps.parts) await p.beforeDelete?.(userId);
      const anonId = `deleted_${deps.newId()}`;
      await deps.atomic("privacy.delete_account", deps.parts.flatMap((p) => p.deletionStatements(userId, anonId)) as never);
      await deps.accounts.deleteAccount(userId);
    },
  };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
