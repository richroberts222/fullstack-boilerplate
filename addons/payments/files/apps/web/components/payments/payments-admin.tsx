"use client";

import { formatPrice } from "@app-boilerplate/validation";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ownerCancelPlan, refundPayment } from "@/app/admin/payments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paymentsCsv } from "@/lib/payments/payments-csv";
import { toCents } from "@/lib/payments/pricing-view";

// The owner's payments (/docs/features/payments.md AC30, AC31; S10). Every rule is in the
// access service: it refunds through the provider, ends access on a full refund, and writes the audit.

export type PaymentView = {
  id: string;
  userId: string;
  member: string;
  entitlementId: string;
  title: string;
  billing: string;
  status: string;
  planStopsAllowed: boolean;
  amountCents: number;
  refundedCents: number;
  provider: string;
  paidAt: string;
};

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const HOW: Record<string, string> = { one_time: "Once", monthly: "Monthly", installments: "Payment plan" };

function RefundForm({ p, onDone }: { p: PaymentView; onDone: () => void }) {
  const left = p.amountCents - p.refundedCents;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      data-testid={`refund-form-${p.id}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const cents = amount.trim() === "" ? null : toCents(amount);
        const what = cents === null ? `the full ${formatPrice(left)}` : formatPrice(cents);
        if (!window.confirm(`Refund ${what} to ${p.member}? This sends money back through the payment provider.`)) return;
        const result = await refundPayment({ paymentId: p.id, amountCents: cents, reason });
        if (!result.ok) return setMessage(result.error.message);
        setMessage(result.data.accessEnded ? "Refunded. Their access has ended." : "Refunded.");
        onDone();
      }}
    >
      <Label htmlFor={`refund-amount-${p.id}`}>Dollars to refund (empty = all {formatPrice(left)} that is left)</Label>
      <Input id={`refund-amount-${p.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`refund-amount-${p.id}`} />
      <Label htmlFor={`refund-reason-${p.id}`}>Why (kept in the record)</Label>
      <Input id={`refund-reason-${p.id}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`refund-reason-${p.id}`} />
      <p className="text-sm text-muted-foreground">A full refund ends the access this payment bought and stops the plan. A part refund changes no access.</p>
      <Button type="submit" size="sm" variant="destructive" disabled={reason.trim() === ""} data-testid={`refund-submit-${p.id}`}>
        Refund
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground" data-testid={`refund-status-${p.id}`}>
          {message}
        </p>
      )}
    </form>
  );
}

function PaymentRow({ p }: { p: PaymentView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const left = p.amountCents - p.refundedCents;

  async function stop(when: "period_end" | "now") {
    const reason = window.prompt(when === "now" ? "Why stop this plan now? Their access ends now. (kept in the record)" : "Why stop this plan at the end of the paid period? (kept in the record)");
    if (!reason?.trim()) return;
    if (!window.confirm(`Stop ${p.member}'s plan ${when === "now" ? "now (access ends now)" : "at the end of the paid period"}?`)) return;
    const result = await ownerCancelPlan({ entitlementId: p.entitlementId, when, reason });
    setMessage(result.ok ? "Stopped." : result.error.message);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0" data-testid={`payment-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{formatPrice(p.amountCents)}</span>
        {p.refundedCents > 0 && <Badge variant="outline">Refunded {formatPrice(p.refundedCents)}</Badge>}
        <Badge variant="secondary">{HOW[p.billing] ?? p.billing}</Badge>
        {p.status === "revoked" && <Badge variant="outline">Access ended</Badge>}
        {p.status === "canceled" && <Badge variant="outline">Plan stopped</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {p.member} · {p.title} · {when(p.paidAt)} · {p.provider}
      </p>
      <div className="flex flex-wrap gap-2">
        {left > 0 && (
          <Button variant="outline" size="sm" data-testid={`payment-refund-${p.id}`} onClick={() => setOpen(!open)}>
            Refund
          </Button>
        )}
        {p.planStopsAllowed && (
          <>
            <Button variant="ghost" size="sm" data-testid={`payment-stop-end-${p.id}`} onClick={() => stop("period_end")}>
              Stop plan at period end
            </Button>
            <Button variant="ghost" size="sm" data-testid={`payment-stop-now-${p.id}`} onClick={() => stop("now")}>
              Stop plan now
            </Button>
          </>
        )}
      </div>
      {open && left > 0 && <RefundForm p={p} onDone={() => router.refresh()} />}
      {message && (
        <p role="status" className="text-sm text-muted-foreground" data-testid={`payment-status-${p.id}`}>
          {message}
        </p>
      )}
    </li>
  );
}

export function PaymentsAdmin({ payments }: { payments: PaymentView[] }) {
  const totalCents = payments.reduce((n, p) => n + p.amountCents - p.refundedCents, 0);
  return (
    <Card data-testid="payments-list">
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription data-testid="payments-summary">
          {payments.length} payments, {formatPrice(totalCents)} after refunds.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          variant="outline"
          className="w-fit"
          disabled={payments.length === 0}
          data-testid="payments-export"
          onClick={() => {
            const csv = paymentsCsv(payments.map((p) => ({ paidAt: p.paidAt, member: p.member, title: p.title, billing: HOW[p.billing] ?? p.billing, amountCents: p.amountCents, refundedCents: p.refundedCents, provider: p.provider, paymentId: p.id })));
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download CSV for the accountant
        </Button>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="payments-empty">
            No payments yet.
          </p>
        ) : (
          <ul>
            {payments.map((p) => (
              <PaymentRow key={p.id} p={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
