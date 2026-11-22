import type { Rule } from "./authorize";

/**
 * Allow-list: the actor's Clerk user ID is one of the configured ids (the site owner list, which is
 * configuration and never a client value, `/docs/permissions.md` rule 8). An empty list denies everyone.
 * The payments add-on checks every owner action with this rule; the application passes its owner ids
 * (for example the `OWNER_USER_IDS` setting) when it wires the services in `lib/addons/payments.ts`.
 */
export const inAllowList =
  <R = void>(ids: readonly string[]): Rule<R> =>
  (actor) =>
    actor.userId.length > 0 && ids.includes(actor.userId);
