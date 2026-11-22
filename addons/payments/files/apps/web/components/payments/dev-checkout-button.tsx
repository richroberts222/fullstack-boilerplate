"use client";

import Link from "next/link";
import { useState } from "react";

import { completeDevCheckout } from "@/app/account/payments-actions";
import { Button } from "@/components/ui/button";

// Completes the test checkout (/docs/features/payments.md, controls inventory).
export function DevCheckoutButton({ token, completed }: { token: string; completed: boolean }) {
  const [done, setDone] = useState(completed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="flex flex-col gap-2" data-testid="dev-checkout-done">
        <p>You&apos;re in. Your access is ready.</p>
        <Button nativeButton={false} render={<Link href="/dashboard" data-testid="dev-checkout-account-link" />} data-testid="dev-checkout-account">
          See your access
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={busy}
        data-testid="dev-checkout-complete"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await completeDevCheckout({ token });
          setBusy(false);
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          setDone(true);
        }}
      >
        Complete test purchase
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="dev-checkout-error">
          {error}
        </p>
      )}
    </div>
  );
}
