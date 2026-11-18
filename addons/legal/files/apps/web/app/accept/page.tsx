import { redirect } from "next/navigation";

import { AcceptForm } from "@/components/legal/accept-form";
import { requireUserId } from "@/lib/auth/server";
import { getPrivacyService } from "@/lib/addons/legal";
import { createServiceContext } from "@/lib/services";
import { safeNextPath } from "@/lib/legal-gate";

export const metadata = { title: "Before you start", robots: { index: false } };
export const dynamic = "force-dynamic";

// Accept the Terms and Privacy Policy and confirm age (/docs/features/legal-gate.md AC1 to AC3). Sign-in
// is required by proxy.ts. A member who already accepted the wording in force goes straight on.
export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  const status = await getPrivacyService().getStatus(createServiceContext(await requireUserId()));
  if (status.accepted) redirect(next);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Before you start</h1>
        <p className="text-muted-foreground">Please read and accept these to use your account.</p>
      </div>
      <AcceptForm minimumAge={status.minimumAge} next={next} />
    </main>
  );
}
