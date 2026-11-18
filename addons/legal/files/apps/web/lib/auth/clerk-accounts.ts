import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import type { AccountsPort } from "../services/privacy";

// The member's sign-in account at Clerk, for their data export and account deletion
// (/docs/features/legal-gate.md, legal add-on). Server side only.

export function createClerkAccounts(): AccountsPort {
  return {
    async getProfile(userId) {
      const client = await clerkClient();
      try {
        const u = await client.users.getUser(userId);
        return {
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "",
          email: u.primaryEmailAddress?.emailAddress ?? null,
          createdAt: u.createdAt ? new Date(u.createdAt) : null,
        };
      } catch {
        return null;
      }
    },
    async deleteAccount(userId) {
      const client = await clerkClient();
      await client.users.deleteUser(userId);
    },
  };
}
