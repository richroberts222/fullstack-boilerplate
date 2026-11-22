import { apiRoute } from "../../../../../lib/api/route";
import { getAccessService } from "../../../../../lib/addons/payments";

// Stripe's notifications (/docs/features/payments.md AC23 to AC26, O2). Public to the router;
// every call is refused unless its signature verifies (the adapter checks it against
// STRIPE_WEBHOOK_SECRET, and an empty secret refuses everything). The raw body is read as text because
// the signature covers the exact bytes, so no input schema is declared. Answers through the shared
// wrapper: 200 handled or ignored; 403 bad signature; 404 a plan not known yet and 503 not paid yet,
// both so Stripe retries later.
export const dynamic = "force-dynamic";

export const POST = apiRoute({
  auth: "public",
  handle: async (_ctx, _input, request) => getAccessService().handlePaymentEvent(await request.text(), request.headers.get("stripe-signature")),
});
