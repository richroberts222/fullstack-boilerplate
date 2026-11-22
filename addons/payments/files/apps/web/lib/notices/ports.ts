// Member notices port (/docs/features/grace-period.md). No email service is chosen yet (Rich decides,
// and it may cost money), so the first adapter only writes a log line with no personal data. A mail
// adapter replaces it without touching the access service.

export type AccessEndedNotice = { userId: string; entitlementId: string; title: string };

export type NoticesPort = {
  /** The one quiet final notice when paid access ends after the grace period. */
  accessEnded(notice: AccessEndedNotice): Promise<void>;
};

export function createLogNotices(log: (line: string) => void = (line) => console.info(line)): NoticesPort {
  return {
    // The user id and title stay out of the log: the entitlement id is enough to trace it.
    accessEnded: async ({ entitlementId }) => log(`notice.access_ended entitlement=${entitlementId}`),
  };
}
