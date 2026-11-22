import { OfferCard } from "@/components/payments/offer-card";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessService, getScopeCatalog } from "@/lib/addons/payments";
import { getUserId } from "@/lib/auth/server";
import { groupOffers } from "@/lib/payments/pricing-view";
import { scopeChoices } from "@/lib/services/scope-catalog";

export const metadata = { title: "Ways to get access", description: "Basic and upgraded access. Pay monthly, for a year, in full, or in a payment plan." };
export const dynamic = "force-dynamic";

// The pricing page (/docs/features/payments.md): per group, the basic tier and the upgraded tier (basic plus bonus
// content) side by side, and under each the ways to pay. Anyone may look; buying needs an account. The price a
// code gives comes from the server.
export default async function PricingPage() {
  const catalog = getScopeCatalog();
  const [offers, groupChoices, userId] = await Promise.all([getAccessService().getPublicOffers(), scopeChoices(catalog, "groups"), getUserId()]);
  const groups = groupOffers(offers, groupChoices);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-4 sm:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Ways to get access</h1>
        <p className="text-muted-foreground">Basic gives you the main content. Upgraded adds all the bonus content. Pay monthly, for a year, in full, or in a payment plan where offered.</p>
      </div>
      {groups.length === 0 ? (
        <Card data-testid="pricing-empty">
          <CardHeader>
            <CardTitle>Nothing is for sale yet</CardTitle>
            <CardDescription>Check back soon.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        groups.map((g) => {
          const basic = g.offers.filter((o) => !o.includesBonus);
          const upgraded = g.offers.filter((o) => o.includesBonus);
          return (
            <section key={g.name} className="flex flex-col gap-4" aria-label={g.name} data-testid={`pricing-group-${g.name}`}>
              <h2 className="text-2xl font-semibold">{g.name}</h2>
              <div className="grid gap-6 md:grid-cols-2">
                {[
                  { key: "basic", label: "Basic", note: "The main content", list: basic },
                  { key: "upgraded", label: "Upgraded", note: "The main content and all the bonus content", list: upgraded },
                ].map((tier) => (
                  <div key={tier.key} className="flex flex-col gap-3" data-testid={`pricing-tier-${g.name}-${tier.key}`}>
                    <div>
                      <h3 className="text-lg font-semibold">{tier.label}</h3>
                      <p className="text-sm text-muted-foreground">{tier.note}</p>
                    </div>
                    {tier.list.length === 0 && <p className="text-sm text-muted-foreground">Not offered right now.</p>}
                    <ul className="flex flex-col gap-3">
                      {tier.list.map((o) => (
                        <li key={o.id}>
                          <OfferCard offer={o} signedIn={userId !== null} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
