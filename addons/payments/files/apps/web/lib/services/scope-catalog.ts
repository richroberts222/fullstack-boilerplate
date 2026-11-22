// The one thing the payments add-on asks the application (/docs/features/payments.md "Vocabulary"):
// which groups and which parts of what it sells exist. An offer or a scholarship may only name ids this returns,
// so nothing is sold that unlocks nothing by mistake. The application fills it in `lib/addons/payments.ts`.
export type ScopeCatalog = {
  /** Every id the application has of this kind, as strings. */
  knownIds(kind: "groups" | "parts"): Promise<string[]>;
};
