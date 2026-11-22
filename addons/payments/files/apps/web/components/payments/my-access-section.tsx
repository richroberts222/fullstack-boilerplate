import { GraceBanner } from "@/components/payments/grace-banner";
import { MyAccess } from "@/components/payments/my-access";
import { getAccessService, getPaymentsEnv } from "@/lib/addons/payments";
import { createServiceContext, runService } from "@/lib/services";

// The dashboard's payments section (/docs/features/payments.md): the grace-period notice (when one applies) and what the
// member holds. The access service decides everything shown; a service failure shows nothing rather than
// breaking the page.
export async function MyAccessSection({ userId }: { userId: string }) {
  const ctx = createServiceContext(userId);
  const [items, alert, canManageBilling] = await Promise.all([
    runService(async () =>
      (await getAccessService().getMyAccess(ctx)).map((a) => ({
        ...a,
        paidThrough: a.paidThrough?.toISOString() ?? null,
        graceEndsAt: a.graceEndsAt?.toISOString() ?? null,
      })),
    ),
    runService(() => getAccessService().getGraceAlert(ctx)),
    getAccessService().canManageBilling(ctx),
  ]);
  return (
    <>
      {alert.ok && alert.data && <GraceBanner title={alert.data.title} graceEndsAt={alert.data.graceEndsAt.toISOString()} continueOfferId={alert.data.continueOfferId} />}
      {items.ok && <MyAccess items={items.data} devPayments={getPaymentsEnv().paymentsProvider === "dev"} canManageBilling={canManageBilling} />}
    </>
  );
}
