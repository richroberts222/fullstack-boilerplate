import { PAYMENTS_SETTING_KEYS, resolvePaymentsSettings, type PaymentsSettings, type UpdatePaymentsSettingsInput } from "@app-boilerplate/validation";

import type { AuditRepo, SettingsRepo } from "../../db/settings";
import { authorize, type Rule } from "../auth/authorize";
import type { AtomicRunner } from "./atomic";
import type { ServiceContext } from "./context";

// The payments add-on's owner settings: read by anyone on the server, changed only by the owner, each change
// written together with an audit entry holding the prior value.

export type PaymentsSettingsDeps = { settings: SettingsRepo; audit: AuditRepo; atomic: AtomicRunner; isSiteOwner: Rule; newId: () => string };

export function createPaymentsSettingsService(deps: PaymentsSettingsDeps) {
  const read = async (): Promise<PaymentsSettings> => resolvePaymentsSettings(await deps.settings.listSettings());
  return {
    /** All payments settings with defaults applied. Server use only. */
    getSettings: read,

    async getOwnerSettings(ctx: ServiceContext): Promise<PaymentsSettings> {
      await authorize(ctx.actor, deps.isSiteOwner, undefined);
      return read();
    },

    /** Saves the settings that changed, each with an audit entry, as one unit. Returns the keys saved. */
    async updateSettings(ctx: ServiceContext, input: UpdatePaymentsSettingsInput): Promise<{ changed: string[] }> {
      await authorize(ctx.actor, deps.isSiteOwner, undefined);
      const current = await read();
      const changed = PAYMENTS_SETTING_KEYS.filter((k) => input[k] !== undefined && input[k] !== current[k]);
      if (changed.length === 0) return { changed: [] };
      const statements = changed.flatMap((key) => [
        deps.settings.upsertStatement(key, input[key]),
        deps.audit.insertStatement({ id: deps.newId(), actorUserId: ctx.actor.userId, action: "settings.update", subject: key, before: current[key], after: input[key] }),
      ]);
      await deps.atomic("settings.update", statements as never);
      return { changed };
    },
  };
}

export type PaymentsSettingsService = ReturnType<typeof createPaymentsSettingsService>;
