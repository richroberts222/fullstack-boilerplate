// Where the accept page sends a member afterwards (/docs/features/legal-gate.md). Only a path on this
// site is followed, so the page cannot be used to send someone elsewhere (an open redirect).
export function safeNextPath(next: string | undefined): string {
  if (typeof next !== "string" || !/^\/(?![/\\])[A-Za-z0-9/_\-?=&.]*$/.test(next)) return "/dashboard";
  return next;
}
