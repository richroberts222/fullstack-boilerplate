import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPaymentsEnv } from "@/lib/addons/payments";
import { getUserId } from "@/lib/auth/server";
import { can } from "@/lib/auth/authorize";
import { inAllowList } from "@/lib/auth/site-owner";

export const metadata = { title: "Owner home" };
export const dynamic = "force-dynamic";

// The owner's start page (/docs/features/payments.md): links to the owner screens. The proxy requires sign-in; this
// page shows the links only to a listed site owner, and every screen and action checks again on the server.
const LINKS = [
  { href: "/admin/offers", key: "offers", label: "Offers and prices", note: "What members can buy" },
  { href: "/admin/coupons", key: "coupons", label: "Coupon codes", note: "Codes members type at checkout" },
  { href: "/admin/payments", key: "payments", label: "Payments", note: "Every payment, refunds, and a file for the accountant" },
];

export default async function AdminHomePage() {
  const userId = await getUserId();
  const isOwner = userId !== null && await can({ userId }, inAllowList(getPaymentsEnv().ownerUserIds), undefined);
  if (!isOwner) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:p-8">
        <Card data-testid="admin-not-allowed">
          <CardHeader>
            <CardTitle>This page is for the site owner</CardTitle>
            <CardDescription>You are signed in, but this account is not the owner.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-3xl font-bold tracking-tight">Owner home</h1>
      <ul className="flex flex-col gap-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Link href={l.href} className="text-primary underline-offset-4 hover:underline" data-testid={`admin-link-${l.key}`}>
                    {l.label}
                  </Link>
                </CardTitle>
                <CardDescription>{l.note}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
