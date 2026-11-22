import Link from "next/link";

import { PaymentsAdmin } from "@/components/payments/payments-admin";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPaymentsReadService } from "@/lib/addons/payments";
import { requireUserId } from "@/lib/auth/server";
import { createServiceContext, runService } from "@/lib/services";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

// The owner's payments (/docs/features/payments.md): every payment with its refunds, refund and stop-plan buttons, and a
// CSV for the accountant. ?member=<id> shows one member's.
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const member = (await searchParams).member;
  const ctx = createServiceContext(await requireUserId());
  const result = await runService(() => getPaymentsReadService().listPayments(ctx, member && /^user_[A-Za-z0-9]+$/.test(member) ? member : undefined));
  if (!result.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:p-8">
        <Card data-testid="payments-not-allowed">
          <CardHeader>
            <CardTitle>This page is for the site owner</CardTitle>
            <CardDescription>You are signed in, but this account cannot see payments.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  const label = (id: string) => (id.startsWith("deleted_") ? "Deleted member" : id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground">Every payment, newest first. Refunds go back through the payment provider and are recorded in the audit log.</p>
        <div className="flex gap-4 text-sm">
          <Link href="/admin" className="text-primary underline-offset-4 hover:underline" data-testid="payments-admin-link">
            Owner home
          </Link>
          {member && (
            <Link href="/admin/payments" className="text-primary underline-offset-4 hover:underline" data-testid="payments-all-link">
              All payments
            </Link>
          )}
        </div>
      </div>
      <PaymentsAdmin payments={result.data.map((p) => ({ ...p, member: label(p.userId), paidAt: p.paidAt.toISOString() }))} />
    </main>
  );
}
