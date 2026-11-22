import Link from "next/link";

import { CouponsEditor } from "@/components/payments/coupons-editor";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessService, getPricingService } from "@/lib/addons/payments";
import { requireUserId } from "@/lib/auth/server";
import { createServiceContext, runService } from "@/lib/services";

export const metadata = { title: "Coupon codes" };
export const dynamic = "force-dynamic";

// The owner's coupon codes (/docs/features/payments.md). Sign-in is required by proxy.ts; the services decide whether
// this person is the owner.
export default async function CouponsPage() {
  const ctx = createServiceContext(await requireUserId());
  const result = await runService(async () => {
    const [coupons, offers] = await Promise.all([getPricingService().listCoupons(ctx), getAccessService().getOwnerOffers(ctx)]);
    return { coupons, offers };
  });
  if (!result.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:p-8">
        <Card data-testid="coupons-not-allowed">
          <CardHeader>
            <CardTitle>This page is for the site owner</CardTitle>
            <CardDescription>You are signed in, but this account cannot change coupon codes.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  const { coupons, offers } = result.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Coupon codes</h1>
        <p className="text-muted-foreground">Codes members type at checkout. Every change is recorded with who made it and what it was before.</p>
        <div className="flex gap-4 text-sm">
          <Link href="/admin/offers" className="text-primary underline-offset-4 hover:underline" data-testid="coupons-offers-link">
            Offers and prices
          </Link>
        </div>
      </div>
      <CouponsEditor
        coupons={coupons.map((c) => ({ id: c.id, code: c.code, kind: c.kind, value: c.value, offerIds: c.offerIds, endsOn: c.endsAt ? c.endsAt.toISOString().slice(0, 10) : null, maxUses: c.maxUses, usedCount: c.usedCount, isActive: c.isActive }))}
        offers={offers.map((o) => ({ id: o.id, title: o.title }))}
      />
    </main>
  );
}
