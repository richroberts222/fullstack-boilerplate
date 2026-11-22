// The one thing the payments add-on asks the application (/docs/features/payments.md "Vocabulary"):
// which groups and which parts of what it sells exist. An offer or a scholarship may only name ids this returns,
// so nothing is sold that unlocks nothing by mistake. The application fills it in `lib/addons/payments-scopes.ts`.
export type ScopeCatalog = {
  /** Every id the application has of this kind, as strings. */
  knownIds(kind: "groups" | "parts"): Promise<string[]>;
  /**
   * Optional: the same ids with a name a person can read, for the owner's offers screen and the pricing page.
   * Without it those screens show the ids.
   */
  choices?(kind: "groups" | "parts"): Promise<{ id: string; title: string }[]>;
};

/** The names to show: the application's own if it gave them, otherwise the ids. */
export async function scopeChoices(catalog: ScopeCatalog, kind: "groups" | "parts"): Promise<{ id: string; title: string }[]> {
  if (catalog.choices) return catalog.choices(kind);
  return (await catalog.knownIds(kind)).map((id) => ({ id, title: id }));
}
