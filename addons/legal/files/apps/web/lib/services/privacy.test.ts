import { PRIVACY_VERSION, TERMS_VERSION } from "@app-boilerplate/validation";
import { describe, expect, it } from "vitest";

import type { AcceptanceRow, AccountDataPart } from "../../db/legal";
import { createServiceContext } from "./context";
import { createPrivacyService } from "./privacy";
import { runService } from "./run";

// The legal gate (/docs/features/legal-gate.md). In-memory fakes: rows tagged with a part, deletion
// statements as functions run by a fake atomic runner that restores everything if one throws.

type Row = { part: string; userId: string; id: string };

function setup(opts: { beforeDeleteFails?: boolean; minimumAge?: number } = {}) {
  const acceptances: AcceptanceRow[] = [];
  const rows: Row[] = [
    { part: "notes", userId: "user_ann", id: "n1" },
    { part: "notes", userId: "user_bob", id: "n2" },
    { part: "payments", userId: "user_ann", id: "p1" },
  ];
  const prepared: string[] = [];
  const deletedAccounts: string[] = [];
  const part = (name: string, anonymize: boolean): AccountDataPart => ({
    name,
    tables: [name],
    exportFor: async (userId) => rows.filter((r) => r.part === name && r.userId === userId).map(({ id }) => ({ id })),
    deletionStatements: (userId, anonId) => [
      (() => {
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i]!;
          if (r.part !== name || r.userId !== userId) continue;
          if (anonymize) r.userId = anonId;
          else rows.splice(i, 1);
        }
      }) as never,
    ],
  });
  const parts: AccountDataPart[] = [
    part("notes", false),
    {
      ...part("payments", true),
      beforeDelete: async (userId) => {
        if (opts.beforeDeleteFails) throw new Error("provider down");
        prepared.push(userId);
      },
    },
  ];
  let n = 0;
  const svc = createPrivacyService({
    repo: {
      latestAcceptance: async (userId) => [...acceptances].reverse().find((a) => a.userId === userId) ?? null,
      insertAcceptance: async (row) => void acceptances.push(row),
    },
    parts,
    accounts: {
      getProfile: async (userId) => ({ name: userId, email: `${userId}@example.com`, createdAt: null }),
      deleteAccount: async (userId) => void deletedAccounts.push(userId),
    },
    atomic: (async (_op: string, statements: (() => void)[]) => {
      const before = structuredClone(rows);
      try {
        for (const s of statements) s();
      } catch (e) {
        rows.splice(0, rows.length, ...before);
        throw e;
      }
      return [];
    }) as never,
    minimumAge: opts.minimumAge ?? 18,
    now: () => new Date("2027-01-01T12:00:00Z"),
    newId: () => `id${n++}`,
  });
  return { svc, acceptances, rows, prepared, deletedAccounts };
}

const ann = createServiceContext("user_ann");

describe("legal gate", () => {
  it("AC1, AC3: acceptance records the versions in force, the minimum age confirmed and the time", async () => {
    const { svc, acceptances } = setup({ minimumAge: 21 });
    expect(await svc.hasAccepted("user_ann")).toBe(false);
    await svc.accept(ann, { acceptTerms: true, confirmAge: true });
    expect(acceptances).toEqual([{ id: "id0", userId: "user_ann", termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, minimumAge: 21, acceptedAt: new Date("2027-01-01T12:00:00Z") }]);
    expect(await svc.hasAccepted("user_ann")).toBe(true);
    expect(await svc.hasAccepted("user_bob")).toBe(false);
  });

  it("AC2: an acceptance of older wording does not count, so a new version asks again", async () => {
    const { svc, acceptances } = setup();
    acceptances.push({ id: "old", userId: "user_ann", termsVersion: "older", privacyVersion: PRIVACY_VERSION, minimumAge: 18, acceptedAt: new Date("2025-01-01") });
    expect(await svc.hasAccepted("user_ann")).toBe(false);
  });

  it("AC5: the export holds the caller's profile and every part's rows, and nobody else's", async () => {
    const { svc } = setup();
    const file = await svc.exportMyData(ann);
    expect(file.filename).toBe("my-data-2027-01-01.json");
    const data = JSON.parse(file.json);
    expect(data.account.email).toBe("user_ann@example.com");
    expect(data.notes).toEqual([{ id: "n1" }]);
    expect(data.payments).toEqual([{ id: "p1" }]);
    expect(file.json).not.toContain("user_bob");
  });

  it("AC6: deletion prepares every part first, deletes or anonymizes the caller's rows only, then removes the sign-in account", async () => {
    const { svc, rows, prepared, deletedAccounts } = setup();
    await svc.deleteMyAccount(ann, { confirm: "delete" });
    expect(prepared).toEqual(["user_ann"]);
    expect(rows.filter((r) => r.userId === "user_ann")).toEqual([]);
    expect(rows.find((r) => r.id === "p1")?.userId).toMatch(/^deleted_/);
    expect(rows.find((r) => r.id === "n2")?.userId).toBe("user_bob");
    expect(rows.some((r) => r.id === "n1")).toBe(false);
    expect(deletedAccounts).toEqual(["user_ann"]);
  });

  it("AC7: if a part's preparation fails, nothing is deleted", async () => {
    const { svc, rows, deletedAccounts } = setup({ beforeDeleteFails: true });
    const before = structuredClone(rows);
    expect((await runService(() => svc.deleteMyAccount(ann, { confirm: "DELETE" }))).ok).toBe(false);
    expect(rows).toEqual(before);
    expect(deletedAccounts).toEqual([]);
  });

  it("AC8: deletion is refused without the typed confirmation", async () => {
    const { svc, rows, deletedAccounts } = setup();
    // A request that would succeed with "DELETE" fails with anything else.
    expect((await runService(() => svc.deleteMyAccount(ann, { confirm: "yes" }))).ok).toBe(false);
    expect(rows.some((r) => r.userId === "user_ann")).toBe(true);
    expect(deletedAccounts).toEqual([]);
  });
});
