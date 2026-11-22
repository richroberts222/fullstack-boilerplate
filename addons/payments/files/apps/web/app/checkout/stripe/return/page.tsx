import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserId } from "@/lib/auth/server";
import { getAccessService } from "@/lib/addons/payments";
import { createServiceContext, runService } from "@/lib/services";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

// Back from Stripe's checkout page (/docs/features/payments.md AC24). The access service asks
// Stripe what was paid; the session id in the address is only a question, never proof of payment.
export default async function StripeReturnPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const ctx = createServiceContext(await requireUserId());
  const result = typeof sessionId === "string" && /^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId) ? await runService(() => getAccessService().completeProviderCheckout(ctx, sessionId)) : null;
  const done = result?.ok && result.data.status !== "pending";
  const pending = result?.ok && result.data.status === "pending";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <Card data-testid={done ? "stripe-return-done" : pending ? "stripe-return-pending" : "stripe-return-problem"}>
        <CardHeader>
          <CardTitle>{done ? "You're in" : pending ? "Payment is still processing" : "We could not confirm this payment"}</CardTitle>
          <CardDescription>
            {done
              ? "Thank you. Your access is ready."
              : pending
                ? "This can take a minute. Refresh this page, or check My access shortly."
                : "If you were charged, your access will appear shortly. Otherwise, please try again from the pricing page."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button nativeButton={false} render={<Link href="/dashboard" data-testid="stripe-return-account-link" />} data-testid="stripe-return-account">
            See my access
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
