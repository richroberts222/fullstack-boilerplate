import { describe, expect, it } from "vitest";

import { csvCell, paymentsCsv } from "./payments-csv";

const row = { paidAt: "2026-11-18T12:00:00.000Z", member: "Pat", title: "God, Basic", billing: "monthly", amountCents: 2950, refundedCents: 1000, provider: "stripe", paymentId: "p1" };

describe("accountant CSV (S10)", () => {
  it("writes a header, dollars from cents, the net after refunds, and quotes a comma", () => {
    const lines = paymentsCsv([row]).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date (UTC),Member,Offer,How paid,Amount (USD),Refunded (USD),Net (USD),Provider,Payment id");
    expect(lines[1]).toBe('2026-11-18,Pat,"God, Basic",monthly,29.50,10.00,19.50,stripe,p1');
  });

  it("doubles quotes and defuses a cell that a spreadsheet would run as a formula", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("plain")).toBe("plain");
  });
});
