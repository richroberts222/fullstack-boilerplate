import "server-only";

import type { Result } from "@app-boilerplate/shared";
import { parseInput } from "@app-boilerplate/validation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { reportUnexpectedError } from "@/lib/api/report";
import { requireUserId } from "@/lib/auth/server";
import { createServiceContext, runService, validationFailed, type ServiceContext } from "@/lib/services";
// addons: action imports

// The shared shape of every server action (/docs/data-mutations.md): identity from Clerk, untrusted input
// parsed with the shared schema, then the service, which makes every permission decision. It lives
// outside the "use server" files on purpose: anything exported from those becomes a callable endpoint.
//
//   "use server";
//   export const createItem = async (raw: unknown) => act(createItemSchema, raw, (ctx, input) => getItemService().create(ctx, input));
//
// `options.limit` names a per-member rate limit when the rate-limits add-on is installed (/docs/boilerplate.md).

export type ActOptions = { limit?: string };

export async function act<S extends z.ZodType, T>(schema: S, raw: unknown, op: (ctx: ServiceContext, input: z.output<S>) => Promise<T>, options: ActOptions = {}): Promise<Result<T>> {
  const result = await runService(async () => {
    const ctx = createServiceContext(await requireUserId());
    // addons: action checks
    void options;
    const parsed = parseInput(schema, raw);
    if (!parsed.ok) throw validationFailed(parsed.error.message, parsed.error.fieldErrors);
    return op(ctx, parsed.data);
  }, reportUnexpectedError);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
