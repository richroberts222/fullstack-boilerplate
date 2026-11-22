import type { ScopeCatalog } from "../services/scope-catalog";

// THE ONE FILE THE APPLICATION OWNS (/docs/features/payments.md "Vocabulary"): tell the payments add-on which
// groups and which parts of what you sell exist. An offer or a scholarship may only name ids returned here.
// Replace the two empty lists with queries on your own tables, for example
//   knownIds: async (kind) => (kind === "groups" ? (await listCourses()).map((c) => c.id) : (await listLessons()).map((l) => l.id)),
// Until you do, no offer can be limited to a group or a part (an offer for everything still works).
export const scopeCatalog: ScopeCatalog = {
  knownIds: async () => [],
};
