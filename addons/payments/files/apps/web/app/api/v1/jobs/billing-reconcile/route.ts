import { apiRoute } from "../../../../../lib/api/route";
import { getAccessService, getPaymentsEnv } from "../../../../../lib/addons/payments";
import { requireJobSecret } from "../../../../../lib/jobs/secret";

// The daily billing check (O10b, /docs/payments.md section 5): compares every plan still billing with the
// payment provider and reports differences. It fixes nothing: the owner decides. Public to the router,
// but refused without the scheduler's secret.
export const GET = apiRoute({
  auth: "public",
  handle: async (_ctx, _input, request) => {
    requireJobSecret(request, getPaymentsEnv().cronSecret);
    const report = await getAccessService().reconcileBilling();
    // Ids only (no names or emails), so the log can be read by whoever runs the hosting.
    if (report.differences.length > 0 || report.failed > 0) console.warn("billing-reconcile", JSON.stringify(report));
    return report;
  },
});
