// The accountant's CSV (S10). Pure text, built in the browser from rows the owner already sees.

export type CsvPayment = { paidAt: string; member: string; title: string; billing: string; amountCents: number; refundedCents: number; provider: string; paymentId: string };

const HEAD = ["Date (UTC)", "Member", "Offer", "How paid", "Amount (USD)", "Refunded (USD)", "Net (USD)", "Provider", "Payment id"];

/** A cell safe for a spreadsheet: quoted, quotes doubled, and a leading = + - @ made harmless so it is never run as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function paymentsCsv(rows: CsvPayment[]): string {
  const lines = rows.map((r) => [r.paidAt.slice(0, 10), r.member, r.title, r.billing, dollars(r.amountCents), dollars(r.refundedCents), dollars(r.amountCents - r.refundedCents), r.provider, r.paymentId].map(csvCell).join(","));
  return [HEAD.join(","), ...lines].join("\r\n") + "\r\n";
}
