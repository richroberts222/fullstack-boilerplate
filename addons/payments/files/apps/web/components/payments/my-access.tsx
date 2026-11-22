"use client";

import { formatPrice } from "@app-boilerplate/validation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

import { cancelPlan, changeTier, openBillingPortal, payNextDevPayment, previewTierChange, resumePlan } from "@/app/account/payments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The member's own access (/docs/features/payments.md, /docs/features/payments.md,
// controls inventory). Dates arrive as ISO text from the server page.

export type MyAccessView = {
  id: string;
  title: string;
  billing: "one_time" | "monthly" | "installments";
  state: "active" | "grace" | "ended";
  paidThrough: string | null;
  graceEndsAt: string | null;
  installmentsPaid: number;
  installmentCount: number;
  canceled: boolean;
  canCancel: boolean;
  includesBonus: boolean;
  paymentFailed: boolean;
  canResume: boolean;
  /** The other tier this monthly plan can move to (O10b), or null. */
  tierChange: { offerId: string; title: string; upgrade: boolean } | null;
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function statusLine(a: MyAccessView): string {
  if (a.state === "ended") return "Ended";
  if (a.state === "grace" && a.graceEndsAt) return `Your access continues until ${day(a.graceEndsAt)}`;
  if (a.paidThrough === null) return "Yours for good";
  if (a.canceled) return `Canceled. Access until ${day(a.paidThrough)}, then a grace period`;
  if (a.billing === "installments") return `Payment ${a.installmentsPaid} of ${a.installmentCount}. Next payment ${day(a.paidThrough)}`;
  return `Renews ${day(a.paidThrough)}`;
}

export function MyAccess({ items, devPayments, canManageBilling }: { items: MyAccessView[]; devPayments: boolean; canManageBilling: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(id: string, op: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(id);
    setMessage(null);
    const result = await op();
    setBusy(null);
    if (!result.ok) setMessage(result.error?.message ?? "Something went wrong");
    router.refresh();
  }

  /** "Manage billing": the payment provider's own page (card, invoices, receipts). */
  async function manageBilling() {
    setBusy("billing");
    setMessage(null);
    const result = await openBillingPortal({});
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setBusy(null);
    setMessage(result.error.message);
  }

  /** Upgrade or downgrade: the server quotes the new price and what is charged now; the member confirms. */
  async function moveTier(id: string, offerId: string) {
    setBusy(id);
    setMessage(null);
    const preview = await previewTierChange({ entitlementId: id, offerId });
    if (!preview.ok) {
      setBusy(null);
      setMessage(preview.error.message);
      return;
    }
    const p = preview.data;
    const now = p.amountDueNowCents > 0 ? ` ${formatPrice(p.amountDueNowCents)} is charged now for the rest of this month.` : " Nothing is charged now; any difference is credited on your next bill.";
    if (!window.confirm(`Move to ${p.title} for ${formatPrice(p.newMonthlyCents)} a month?${now}`)) {
      setBusy(null);
      return;
    }
    const result = await changeTier({ entitlementId: id, offerId });
    setBusy(null);
    if (!result.ok) setMessage(result.error.message);
    else if (result.data.status === "payment_needed") setMessage("The payment for the change did not go through, so nothing changed. Check your card in Manage billing and try again.");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md" data-testid="my-access">
      <CardHeader>
        <CardTitle>My access</CardTitle>
        <CardDescription>What you hold, what it includes, and how it is paid.</CardDescription>
        {canManageBilling && (
          <div>
            <Button variant="outline" size="sm" disabled={busy === "billing"} data-testid="my-access-manage-billing" onClick={manageBilling}>
              Manage billing
            </Button>
            <p className="pt-1 text-xs text-muted-foreground">Update your card, see and download invoices and receipts.</p>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 && (
          <p className="text-muted-foreground" data-testid="my-access-empty">
            Nothing yet.{" "}
            <Link href="/pricing" className="text-primary underline-offset-4 hover:underline" data-testid="my-access-pricing-link">
              See ways to get access
            </Link>
          </p>
        )}
        {items.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0" data-testid={`access-${a.id}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{a.title}</span>
              <Badge variant="secondary" data-testid={`access-tier-${a.id}`}>
                {a.includesBonus ? "Upgraded" : "Basic"}
              </Badge>
              {a.state === "grace" && <Badge variant="outline">Grace period</Badge>}
            </div>
            {a.paymentFailed && (
              <p role="status" className="rounded-lg border border-primary/50 bg-primary/10 p-3 text-sm" data-testid={`access-past-due-${a.id}`}>
                Your latest payment did not go through. Your access is not affected, and the payment will be tried again. If it keeps failing, your plan stops and
                the grace period begins. Your card may have expired or been replaced:{" "}
                {canManageBilling ? "use Manage billing above to update it." : "ask the site owner for help if you would like to update it."}
              </p>
            )}
            {!a.includesBonus && a.state !== "ended" && !a.tierChange && (
              <Link href="/pricing" className="text-sm text-primary underline-offset-4 hover:underline" data-testid={`access-upgrade-${a.id}`}>
                Upgrade to get the bonus content
              </Link>
            )}
            <p className="text-sm text-muted-foreground" data-testid={`access-status-${a.id}`}>
              {statusLine(a)}
            </p>
            <div className="flex flex-wrap gap-2">
              {a.canCancel && (
                <Button variant="outline" size="sm" disabled={busy === a.id} data-testid={`access-cancel-${a.id}`} onClick={() => run(a.id, () => cancelPlan({ entitlementId: a.id }))}>
                  Stop future payments
                </Button>
              )}
              {a.canResume && (
                <Button variant="outline" size="sm" disabled={busy === a.id} data-testid={`access-resume-${a.id}`} onClick={() => run(a.id, () => resumePlan({ entitlementId: a.id }))}>
                  Start this plan again
                </Button>
              )}
              {a.tierChange && (
                <Button
                  variant={a.tierChange.upgrade ? "default" : "outline"}
                  size="sm"
                  disabled={busy === a.id}
                  data-testid={`access-tier-change-${a.id}`}
                  onClick={() => moveTier(a.id, a.tierChange!.offerId)}
                >
                  {a.tierChange.upgrade ? "Upgrade to get the bonus content" : "Switch to basic"}
                </Button>
              )}
              {devPayments && a.canCancel && (
                <Button variant="ghost" size="sm" disabled={busy === a.id} data-testid={`access-dev-pay-${a.id}`} onClick={() => run(a.id, () => payNextDevPayment({ entitlementId: a.id }))}>
                  Test: make the next payment
                </Button>
              )}
            </div>
          </div>
        ))}
        {message && (
          <p role="alert" className="text-sm text-destructive" data-testid="my-access-error">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
