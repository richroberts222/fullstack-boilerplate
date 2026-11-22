import { ForbiddenError } from "../auth/errors";

// Scheduled jobs (/docs/features/grace-period.md). The scheduler (Vercel Cron) sends
// "Authorization: Bearer <CRON_SECRET>". No secret configured means every job request is refused,
// so a job can never be run by a stranger who finds its address.

/** Throws ForbiddenError unless the request carries exactly the configured secret. */
export function requireJobSecret(request: Request, secret: string): void {
  requireJobAuthorization(request.headers.get("authorization"), secret);
}

/** The check itself, on the raw header value (exported so it is tested without HTTP header trimming). */
export function requireJobAuthorization(authorization: string | null, secret: string): void {
  const header = authorization ?? "";
  const expected = `Bearer ${secret}`;
  if (secret === "" || !timingSafeEqual(header, expected)) throw new ForbiddenError();
}

/** Compares without stopping at the first difference, so timing does not reveal the secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
