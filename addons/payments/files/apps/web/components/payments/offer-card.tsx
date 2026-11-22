"use client";

import { describeBilling, formatPrice, type PublicOffer } from "@app-boilerplate/validation";
import Link from "next/link";
import { useState } from "react";

import { quoteOffer } from "@/app/account/payments-actions";
import { BuyButton } from "@/components/payments/buy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planTotalCents } from "@/lib/payments/pricing-view";

// One way to pay for one tier (/docs/features/payments.md, S7). A signed-in member can try a
// code to see the price; the server computes it, and the checkout computes it again.

export function OfferCard({ offer, signedIn }: { offer: PublicOffer; signedIn: boolean }) {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; finalCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    setError(null);
    const result = await quoteOffer({ offerId: offer.id, couponCode: code });
    setBusy(false);
    if (!result.ok) {
      setApplied(null);
      setError(result.error.message);
      return;
    }
    // A blank code quotes the member's own price (a scholarship may apply): show it only when it differs.
    setApplied(result.data.couponCode ? { code: result.data.couponCode, finalCents: result.data.finalCents } : null);
    if (!result.data.couponCode && code.trim() !== "") setError("This code does not work for this.");
  }

  const price = applied ? applied.finalCents : offer.priceCents;
  const shown = describeBilling({ ...offer, priceCents: price });
  const total = offer.billing === "installments" ? `Total ${formatPrice(planTotalCents({ ...offer, priceCents: price }))}` : null;

  return (
    <Card className="h-full" data-testid={`offer-${offer.id}`}>
      <CardHeader>
        <CardTitle>{offer.title}</CardTitle>
        <CardDescription data-testid={`offer-price-line-${offer.id}`}>
          {shown}
          {total ? `. ${total}` : ""}
        </CardDescription>
        {applied && (
          <p className="text-sm font-medium text-primary" data-testid={`offer-quote-${offer.id}`}>
            Code {applied.code} applied: {applied.finalCents === 0 ? "free" : formatPrice(applied.finalCents)} each payment
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offer.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{offer.description}</p>}
        {signedIn ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`offer-coupon-${offer.id}`}>Have a code?</Label>
              <div className="flex gap-2">
                <Input id={`offer-coupon-${offer.id}`} autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} data-testid={`offer-coupon-${offer.id}`} />
                <Button type="button" variant="outline" disabled={busy || code.trim() === ""} onClick={apply} data-testid={`offer-apply-${offer.id}`}>
                  Apply
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive" data-testid={`offer-quote-error-${offer.id}`}>
                  {error}
                </p>
              )}
            </div>
            <BuyButton offerId={offer.id} couponCode={applied?.code} />
          </>
        ) : (
          <Button nativeButton={false} render={<Link href="/sign-in?redirect_url=/pricing" data-testid={`sign-in-to-buy-link-${offer.id}`} />} data-testid={`sign-in-to-buy-${offer.id}`}>
            Sign in to get access
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
