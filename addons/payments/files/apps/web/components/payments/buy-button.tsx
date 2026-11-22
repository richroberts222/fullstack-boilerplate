"use client";

import { useState } from "react";

import { startCheckout } from "@/app/account/payments-actions";
import { Button } from "@/components/ui/button";

// Starts checkout for one offer and follows the payments adapter to its page
// (/docs/features/payments.md, controls inventory).
export function BuyButton({ offerId, label = "Get access", couponCode }: { offerId: string; label?: string; couponCode?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={busy}
        data-testid={`buy-${offerId}`}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await startCheckout({ offerId, couponCode });
          if (!result.ok) {
            setError(result.error.message);
            setBusy(false);
            return;
          }
          window.location.assign(result.data.redirectUrl);
        }}
      >
        {busy ? "One moment..." : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid={`buy-error-${offerId}`}>
          {error}
        </p>
      )}
    </div>
  );
}
