import { describe, expect, it } from "vitest";

import { PAYMENTS_SETTING_DEFAULTS } from "@app-boilerplate/validation";

import type { AuditEvent, AuditRepo, SettingsRepo } from "../../db/settings";
import { inAllowList } from "../auth/site-owner";
import { createServiceContext } from "./context";
import { ServiceError } from "./errors";
import { createPaymentsSettingsService } from "./payments-settings";

// The payments settings service (/docs/features/payments.md): defaults, owner-only changes, audited changes.

function setup(rows: { key: string; value: unknown }[] = []) {
  const stored = [...rows];
  const audits: AuditEvent[] = [];
  const settings = {
    listSettings: async () => stored,
    upsertStatement: (key: string, value: unknown) => ({ key, value }) as never,
  } as unknown as SettingsRepo;
  const audit = { insertStatement: (e: AuditEvent) => ({ audit: e }) as never } as unknown as AuditRepo;
  const atomic = async (_op: string, statements: unknown[]) => {
    for (const s of statements as { key?: string; value?: unknown; audit?: AuditEvent }[]) {
      if (s.audit) audits.push(s.audit);
      else {
        const i = stored.findIndex((r) => r.key === s.key);
        if (i >= 0) stored[i] = { key: s.key!, value: s.value };
        else stored.push({ key: s.key!, value: s.value });
      }
    }
  };
  let n = 0;
  const svc = createPaymentsSettingsService({ settings, audit, atomic: atomic as never, isSiteOwner: inAllowList(["user_owner"]), newId: () => `id-${++n}` });
  return { svc, audits, stored };
}

const owner = createServiceContext("user_owner");
const member = createServiceContext("user_member");

describe("payments settings service", () => {
  it("reads the defaults when nothing is saved, and ignores a stored value that is no longer valid", async () => {
    expect(await setup().svc.getSettings()).toEqual(PAYMENTS_SETTING_DEFAULTS);
    const { svc } = setup([{ key: "gracePeriodDays", value: "ten" }, { key: "somethingElse", value: 1 }]);
    expect((await svc.getSettings()).gracePeriodDays).toBe(PAYMENTS_SETTING_DEFAULTS.gracePeriodDays);
  });

  it("lets only the owner read or change them: a member is refused and nothing is saved", async () => {
    const { svc, stored, audits } = setup();
    await expect(svc.updateSettings(member, { trialDays: 7 })).rejects.toThrow();
    await expect(svc.getOwnerSettings(member)).rejects.toThrow();
    expect(stored).toEqual([]);
    expect(audits).toEqual([]);
    expect(ServiceError).toBeDefined();
  });

  it("saves only what changed, with one audit entry per change holding the prior value", async () => {
    const { svc, audits, stored } = setup([{ key: "gracePeriodDays", value: 30 }]);
    const result = await svc.updateSettings(owner, { gracePeriodDays: 30, trialDays: 7 });
    expect(result.changed).toEqual(["trialDays"]);
    expect(stored.find((r) => r.key === "trialDays")?.value).toBe(7);
    expect(audits).toEqual([{ id: "id-1", actorUserId: "user_owner", action: "settings.update", subject: "trialDays", before: 0, after: 7 }]);
    expect((await svc.updateSettings(owner, { trialDays: 7 })).changed).toEqual([]);
  });
});
