import Link from "next/link";

import { OffersEditor } from "@/components/payments/offers-editor";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessService, getScopeCatalog } from "@/lib/addons/payments";
import { requireUserId } from "@/lib/auth/server";
import { createServiceContext, runService } from "@/lib/services";
import { scopeChoices } from "@/lib/services/scope-catalog";

export const metadata = { title: "Offers and prices" };
export const dynamic = "force-dynamic";

// The owner's offers (/docs/features/payments.md). Sign-in is required by proxy.ts; the service decides whether this
// person is the owner.
export default async function OffersPage() {
  const ctx = createServiceContext(await requireUserId());
  const result = await runService(async () => {
    const catalog = getScopeCatalog();
    const [offers, groups, parts] = await Promise.all([getAccessService().getOwnerOffers(ctx), scopeChoices(catalog, "groups"), scopeChoices(catalog, "parts")]);
    return { offers, groups, parts };
  });
  if (!result.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:p-8">
        <Card data-testid="offers-not-allowed">
          <CardHeader>
            <CardTitle>This page is for the site owner</CardTitle>
            <CardDescription>You are signed in, but this account cannot change offers.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  const { offers, groups, parts } = result.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Offers and prices</h1>
        <p className="text-muted-foreground">What members can buy. Every change is recorded with who made it and what it was before.</p>
        <div className="flex gap-4 text-sm">
          <Link href="/admin" className="text-primary underline-offset-4 hover:underline" data-testid="offers-admin-link">
            Owner home
          </Link>
          <Link href="/admin/coupons" className="text-primary underline-offset-4 hover:underline" data-testid="offers-coupons-link">
            Coupon codes
          </Link>
        </div>
      </div>
      <OffersEditor
        offers={offers.map((o) => ({ id: o.id, title: o.title, description: o.description, priceCents: o.priceCents, billing: o.billing, installmentCount: o.installmentCount, scope: o.scope, scopeIds: o.scopeIds, includesBonus: o.includesBonus, accessDays: o.accessDays, isActive: o.isActive }))}
        groups={groups}
        parts={parts}
      />
    </main>
  );
}
