"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { answerGraceAlert } from "@/app/account/payments-actions";
import { BuyButton } from "@/components/payments/buy-button";
import { Button } from "@/components/ui/button";

// The gentle grace-period banner (/docs/features/payments.md). Wording rules: down to earth,
// never pushy, no discount. "Don't show this again" means exactly that, on every device.

export function GraceBanner({ title, graceEndsAt, continueOfferId }: { title: string; graceEndsAt: string; continueOfferId: string | null }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const ends = new Date(graceEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });

  async function answer(action: "snooze" | "dismiss_forever") {
    setHidden(true);
    await answerGraceAlert({ action });
    router.refresh();
  }

  return (
    <aside role="status" className="border-b bg-muted/40" data-testid="grace-banner">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm">
          Your payment for <span className="font-medium">{title}</span> has stopped, and that&apos;s okay. You still have full access until {ends}. If you&apos;d like
          to keep going, you can continue here. If you&apos;d rather not see this again, tap the button and it&apos;s gone for good.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {continueOfferId && <BuyButton offerId={continueOfferId} label="Continue here" />}
          <Button variant="ghost" size="sm" data-testid="grace-snooze" onClick={() => answer("snooze")}>
            Remind me in a few days
          </Button>
          <Button variant="ghost" size="sm" data-testid="grace-dismiss" onClick={() => answer("dismiss_forever")}>
            Don&apos;t show this again
          </Button>
        </div>
      </div>
    </aside>
  );
}
