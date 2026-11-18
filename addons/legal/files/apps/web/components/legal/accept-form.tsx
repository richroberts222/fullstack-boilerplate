"use client";

import Link from "next/link";
import { useState } from "react";

import { acceptLegal } from "@/app/account/legal-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// The two boxes a member ticks before using their account (/docs/features/legal-gate.md AC1, AC3).
export function AcceptForm({ minimumAge, next }: { minimumAge: number; next: string }) {
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = "text-primary underline-offset-4 hover:underline";
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="accept-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await acceptLegal({ acceptTerms: terms, confirmAge: age });
        if (!result.ok) {
          setError(result.error.message);
          setBusy(false);
          return;
        }
        window.location.assign(next);
      }}
    >
      <Label className="flex min-h-11 items-start gap-3 font-normal leading-snug">
        <Checkbox className="mt-0.5" checked={terms} onCheckedChange={(v) => setTerms(v === true)} data-testid="accept-terms" />
        <span>
          I have read and accept the{" "}
          <Link href="/terms" target="_blank" className={link} data-testid="accept-terms-link">
            Terms of Service
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank" className={link} data-testid="accept-privacy-link">
            Privacy Policy
          </Link>
          .
        </span>
      </Label>
      <Label className="flex min-h-11 items-start gap-3 font-normal leading-snug">
        <Checkbox className="mt-0.5" checked={age} onCheckedChange={(v) => setAge(v === true)} data-testid="accept-age" />
        <span>I am at least {minimumAge} years old.</span>
      </Label>
      <Button type="submit" className="h-11" disabled={busy || !terms || !age} data-testid="accept-submit">
        {busy ? "One moment..." : "Continue"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="accept-error">
          {error}
        </p>
      )}
    </form>
  );
}
