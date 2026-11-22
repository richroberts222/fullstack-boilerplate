"use client";

import { firstFieldError } from "@app-boilerplate/validation";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createCoupon, updateCoupon } from "@/app/admin/payments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { describeCoupon, toCents } from "@/lib/payments/pricing-view";

// The owner's coupon codes (/docs/features/payments.md AC19, AC22, controls inventory).
// Values are typed in dollars or percent and sent in cents or percent; the server computes every price.

export type CouponView = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  offerIds: string[];
  /** Last day it works, as YYYY-MM-DD (UTC), or null. */
  endsOn: string | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
};
export type OfferChoice = { id: string; title: string };

type Form = { code: string; kind: "percent" | "amount"; value: string; offerIds: string[]; endsOn: string; maxUses: string; isActive: boolean };

const EMPTY: Form = { code: "", kind: "percent", value: "", offerIds: [], endsOn: "", maxUses: "", isActive: true };

const toForm = (c: CouponView): Form => ({
  code: c.code,
  kind: c.kind,
  value: c.kind === "percent" ? String(c.value) : (c.value / 100).toFixed(2),
  offerIds: c.offerIds,
  endsOn: c.endsOn ?? "",
  maxUses: c.maxUses === null ? "" : String(c.maxUses),
  isActive: c.isActive,
});

function CouponForm({ initial, id, offers, onDone }: { initial: Form; id: string; offers: OfferChoice[]; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const error = (key: string) =>
    firstFieldError(errors, key) && (
      <p className="text-sm text-destructive" data-testid={`coupon-error-${key}-${id}`}>
        {firstFieldError(errors, key)}
      </p>
    );

  return (
    <form
      className="flex flex-col gap-3"
      data-testid={`coupon-form-${id}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus(null);
        const value = form.kind === "percent" ? (/^\s*\d+\s*$/.test(form.value) ? Number(form.value) : Number.NaN) : toCents(form.value);
        const uses = form.maxUses.trim() === "" ? null : /^\s*\d+\s*$/.test(form.maxUses) ? Number(form.maxUses) : Number.NaN;
        const payload = { kind: form.kind, value, offerIds: form.offerIds, endsOn: form.endsOn === "" ? null : form.endsOn, maxUses: uses, isActive: form.isActive };
        const result = id === "new" ? await createCoupon({ code: form.code, ...payload }) : await updateCoupon({ id, ...payload });
        if (!result.ok) {
          setErrors(result.error.fieldErrors);
          setStatus(result.error.message);
          return;
        }
        setErrors(undefined);
        setStatus("Saved.");
        if (id === "new") setForm(EMPTY);
        router.refresh();
        onDone();
      }}
    >
      {id === "new" && (
        <>
          <Label htmlFor={`coupon-code-${id}`}>Code (letters and numbers, any case)</Label>
          <Input id={`coupon-code-${id}`} maxLength={32} autoCapitalize="characters" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid={`coupon-code-${id}`} />
          {error("code")}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`coupon-kind-${id}`}>Takes off</Label>
          <NativeSelect id={`coupon-kind-${id}`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form["kind"], value: "" })} data-testid={`coupon-kind-${id}`}>
            <option value="percent">A percent</option>
            <option value="amount">A fixed amount in dollars</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`coupon-value-${id}`}>{form.kind === "percent" ? "Percent (1 to 100)" : "Dollars off"}</Label>
          <Input id={`coupon-value-${id}`} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} data-testid={`coupon-value-${id}`} />
          {error("value")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`coupon-ends-${id}`}>Last day it works (empty = no end)</Label>
          <Input id={`coupon-ends-${id}`} type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} data-testid={`coupon-ends-${id}`} />
          {error("endsOn")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`coupon-uses-${id}`}>Most uses (empty = no limit)</Label>
          <Input id={`coupon-uses-${id}`} inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} data-testid={`coupon-uses-${id}`} />
          {error("maxUses")}
        </div>
      </div>

      {offers.length > 0 && (
        <fieldset className="flex flex-col gap-2" data-testid={`coupon-offers-${id}`}>
          <legend className="text-sm font-medium">Works on (none ticked = every offer)</legend>
          {offers.map((o) => (
            <Label key={o.id} className="flex min-h-11 items-center gap-2 font-normal">
              <Checkbox
                checked={form.offerIds.includes(o.id)}
                onCheckedChange={(v) => setForm({ ...form, offerIds: v === true ? [...form.offerIds, o.id] : form.offerIds.filter((s) => s !== o.id) })}
                data-testid={`coupon-offer-${id}-${o.id}`}
              />
              {o.title}
            </Label>
          ))}
        </fieldset>
      )}
      {error("offerIds")}

      <Label className="flex min-h-11 items-center gap-2">
        <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v === true })} data-testid={`coupon-active-${id}`} />
        Turned on
      </Label>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" data-testid={`coupon-save-${id}`}>
          {id === "new" ? "Add code" : "Save"}
        </Button>
        {status && (
          <p role="status" className="text-sm text-muted-foreground" data-testid={`coupon-status-${id}`}>
            {status}
          </p>
        )}
      </div>
    </form>
  );
}

export function CouponsEditor({ coupons, offers }: { coupons: CouponView[]; offers: OfferChoice[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const titles = new Map(offers.map((o) => [o.id, o.title]));

  return (
    <div className="flex flex-col gap-6">
      {coupons.length === 0 && (
        <p className="text-muted-foreground" data-testid="coupons-empty">
          No codes yet. Add your first one below.
        </p>
      )}
      {coupons.map((c) => (
        <Card key={c.id} data-testid={`owner-coupon-${c.id}`}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{c.code}</span>
              <Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "On" : "Off"}</Badge>
            </CardTitle>
            <CardDescription data-testid={`coupon-summary-${c.id}`}>
              {describeCoupon(c)}. Used {c.usedCount}
              {c.maxUses === null ? "" : ` of ${c.maxUses}`} times. {c.endsOn ? `Works through ${c.endsOn}.` : "No end date."}{" "}
              {c.offerIds.length === 0 ? "Works on every offer." : `Works on: ${c.offerIds.map((id) => titles.get(id) ?? "a removed offer").join(", ")}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {editing === c.id ? (
              <CouponForm initial={toForm(c)} id={c.id} offers={offers} onDone={() => setEditing(null)} />
            ) : (
              <Button variant="outline" size="sm" data-testid={`coupon-edit-${c.id}`} onClick={() => setEditing(c.id)}>
                Edit
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>New code</CardTitle>
          <CardDescription>A code takes a percent or a fixed amount off each payment. A code cannot be renamed later; turn it off instead.</CardDescription>
        </CardHeader>
        <CardContent>
          <CouponForm initial={EMPTY} id="new" offers={offers} onDone={() => {}} />
        </CardContent>
      </Card>
    </div>
  );
}
