import { describeBilling } from "@app-boilerplate/validation";
import { notFound } from "next/navigation";

import { DevCheckoutButton } from "@/components/payments/dev-checkout-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserId } from "@/lib/auth/server";
import { getAccessService } from "@/lib/addons/payments";
import { createServiceContext, runService } from "@/lib/services";

export const metadata = { title: "Test checkout" };
export const dynamic = "force-dynamic";

// The test checkout (/docs/features/payments.md). It exists only while PAYMENTS_PROVIDER is
// "dev", which the environment check refuses in production; otherwise the service says "not found".
export default async function DevCheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) notFound();
  const ctx = createServiceContext(await requireUserId());
  const result = await runService(() => getAccessService().getDevCheckout(ctx, token));
  if (!result.ok) notFound();
  const { offer, completed } = result.data;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <Card data-testid="dev-checkout">
        <CardHeader>
          <CardTitle>{offer.title}</CardTitle>
          <CardDescription>{describeBilling(offer)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="dev-checkout-notice">
            Test checkout: no money is charged. Real payments are added later.
          </p>
          <DevCheckoutButton token={token} completed={completed} />
        </CardContent>
      </Card>
    </main>
  );
}
