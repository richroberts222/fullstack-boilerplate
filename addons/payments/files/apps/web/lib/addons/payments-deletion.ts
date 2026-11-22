import "server-only";

import { getDb } from "../../db";
import { createAccessRepo } from "../../db/access";
import { createBillingStopper } from "../services/billing-stop";
import { createPayments } from "./payments";

// Runs before an account is deleted (the legal add-on calls the access part's `beforeDelete`): stop plans that
// still bill and remove the payment provider's customer record. A failure throws, so nothing is deleted.
export async function stopBillingBeforeDelete(userId: string): Promise<void> {
  await createBillingStopper({ repo: createAccessRepo(getDb()), payments: createPayments() })(userId);
}
