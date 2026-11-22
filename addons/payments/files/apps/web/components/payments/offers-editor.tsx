"use client";

import { describeBilling, firstFieldError, formatPrice, type Billing, type Scope } from "@app-boilerplate/validation";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createOffer, deleteOffer, updateOffer } from "@/app/admin/payments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { groupOffers, planTotalCents, toCents } from "@/lib/payments/pricing-view";

// The owner's offers editor (/docs/features/payments.md, controls inventory): what is for
// sale, at what price, billed how, unlocking what.

export type OfferView = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  billing: Billing;
  installmentCount: number;
  scope: Scope;
  scopeIds: string[];
  includesBonus: boolean;
  accessDays: number | null;
  isActive: boolean;
};
export type ScopeChoice = { id: string; title: string };

type Form = Omit<OfferView, "id" | "priceCents" | "accessDays"> & { price: string; accessDays: string };

const EMPTY: Form = { title: "", description: "", price: "", billing: "one_time", installmentCount: 3, scope: "everything", scopeIds: [], includesBonus: false, accessDays: "", isActive: false };

const toForm = (o: OfferView): Form => ({ ...o, price: (o.priceCents / 100).toFixed(2), accessDays: o.accessDays === null ? "" : String(o.accessDays) });

function OfferForm({ initial, id, groups, parts, onDone }: { initial: Form; id: string; groups: ScopeChoice[]; parts: ScopeChoice[]; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const choices = form.scope === "groups" ? groups : form.scope === "parts" ? parts : [];
  const error = (key: string) =>
    firstFieldError(errors, key) && (
      <p className="text-sm text-destructive" data-testid={`offer-error-${key}-${id}`}>
        {firstFieldError(errors, key)}
      </p>
    );

  return (
    <form
      className="flex flex-col gap-3"
      data-testid={`offer-form-${id}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus(null);
        const { price, accessDays, ...rest } = form;
        const days = form.billing === "one_time" && accessDays.trim() !== "" ? Number(accessDays) : null;
        const payload = { ...rest, priceCents: toCents(price), accessDays: days, scopeIds: form.scope === "everything" ? [] : form.scopeIds };
        const result = id === "new" ? await createOffer(payload) : await updateOffer({ id, ...payload });
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
      <Label htmlFor={`offer-title-${id}`}>Name</Label>
      <Input id={`offer-title-${id}`} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid={`offer-title-${id}`} />
      {error("title")}

      <Label htmlFor={`offer-description-${id}`}>Description</Label>
      <Textarea id={`offer-description-${id}`} rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid={`offer-description-${id}`} />
      {error("description")}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`offer-price-${id}`}>Price (dollars)</Label>
          <Input id={`offer-price-${id}`} inputMode="decimal" placeholder="29.00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid={`offer-price-${id}`} />
          {error("priceCents")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`offer-billing-${id}`}>Billed</Label>
          <NativeSelect id={`offer-billing-${id}`} value={form.billing} onChange={(e) => setForm({ ...form, billing: e.target.value as Billing })} data-testid={`offer-billing-${id}`}>
            <option value="one_time">Once (owned for good)</option>
            <option value="monthly">Every month</option>
            <option value="installments">Payment plan</option>
          </NativeSelect>
        </div>
        {form.billing === "one_time" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`offer-days-${id}`}>Days of access (empty = for good; 365 = one year)</Label>
            <Input id={`offer-days-${id}`} inputMode="numeric" value={form.accessDays} onChange={(e) => setForm({ ...form, accessDays: e.target.value })} data-testid={`offer-days-${id}`} />
            {error("accessDays")}
          </div>
        )}
        {form.billing === "installments" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`offer-installments-${id}`}>Number of monthly payments</Label>
            <Input
              id={`offer-installments-${id}`}
              inputMode="numeric"
              value={String(form.installmentCount)}
              onChange={(e) => setForm({ ...form, installmentCount: Number(e.target.value) })}
              data-testid={`offer-installments-${id}`}
            />
            {error("installmentCount")}
          </div>
        )}
      </div>

      <Label htmlFor={`offer-scope-${id}`}>Unlocks</Label>
      <NativeSelect id={`offer-scope-${id}`} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Scope, scopeIds: [] })} data-testid={`offer-scope-${id}`}>
        <option value="everything">Everything</option>
        <option value="groups">Chosen groups</option>
        <option value="parts">Chosen parts</option>
      </NativeSelect>
      {choices.length > 0 && (
        <div className="flex flex-col gap-2" data-testid={`offer-scope-ids-${id}`}>
          {choices.map((c) => (
            <Label key={c.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={form.scopeIds.includes(c.id)}
                onCheckedChange={(v) => setForm({ ...form, scopeIds: v === true ? [...form.scopeIds, c.id] : form.scopeIds.filter((s) => s !== c.id) })}
                data-testid={`offer-scope-id-${id}-${c.id}`}
              />
              {c.title}
            </Label>
          ))}
        </div>
      )}
      {error("scopeIds")}

      <Label className="flex items-center gap-2">
        <Checkbox checked={form.includesBonus} onCheckedChange={(v) => setForm({ ...form, includesBonus: v === true })} data-testid={`offer-bonus-${id}`} />
        Upgraded: includes bonus content
      </Label>

      <Label className="flex items-center gap-2">
        <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v === true })} data-testid={`offer-active-${id}`} />
        For sale now
      </Label>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" data-testid={`offer-save-${id}`}>
          {id === "new" ? "Add offer" : "Save"}
        </Button>
        {status && (
          <p role="status" className="text-sm text-muted-foreground" data-testid={`offer-status-${id}`}>
            {status}
          </p>
        )}
      </div>
    </form>
  );
}

export function OffersEditor({ offers, groups, parts }: { offers: OfferView[]; groups: ScopeChoice[]; parts: ScopeChoice[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {offers.length === 0 && (
        <p className="text-muted-foreground" data-testid="offers-empty">
          Nothing is for sale yet. Add your first offer below.
        </p>
      )}
      {groupOffers(offers, groups).map((g) => (
        <section key={g.name} className="flex flex-col gap-4" data-testid={`offers-group-${g.name}`}>
          <h2 className="text-xl font-semibold">{g.name}</h2>
          {g.offers.map((o) => (
            <Card key={o.id} data-testid={`owner-offer-${o.id}`}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {o.title}
                  <Badge variant="secondary" data-testid={`offer-tier-${o.id}`}>
                    {o.includesBonus ? "Upgraded" : "Basic"}
                  </Badge>
                  <Badge variant={o.isActive ? "default" : "outline"}>{o.isActive ? "For sale" : "Off"}</Badge>
                </CardTitle>
                <CardDescription data-testid={`offer-summary-${o.id}`}>
                  {describeBilling(o)}
                  {o.billing === "installments" ? `. Plan total ${formatPrice(planTotalCents(o))}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {editing === o.id ? (
                  <OfferForm initial={toForm(o)} id={o.id} groups={groups} parts={parts} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" data-testid={`offer-edit-${o.id}`} onClick={() => setEditing(o.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`offer-delete-${o.id}`}
                      onClick={async () => {
                        if (!window.confirm(`Delete "${o.title}"?`)) return;
                        const result = await deleteOffer({ id: o.id });
                        setMessage(result.ok ? null : result.error.message);
                        router.refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
      {message && (
        <p role="alert" className="text-sm text-destructive" data-testid="offers-error">
          {message}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>New offer</CardTitle>
          <CardDescription>For example: the God teaching with Revelations as a bonus, Content Creation on its own, a monthly plan, or lifetime access to everything.</CardDescription>
        </CardHeader>
        <CardContent>
          <OfferForm initial={EMPTY} id="new" groups={groups} parts={parts} onDone={() => {}} />
        </CardContent>
      </Card>
    </div>
  );
}
