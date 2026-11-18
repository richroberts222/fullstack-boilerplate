import { z } from "zod";

// The legal gate (/docs/features/legal-gate.md, legal add-on). The versions name the wording a member
// accepted; change them whenever the Terms or the Privacy Policy change, and every member is asked again.

/** The Terms of Service wording in force. A draft until a lawyer has read it (/docs/risk-and-legal.md). */
export const TERMS_VERSION = "draft-1";
/** The Privacy Policy wording in force. */
export const PRIVACY_VERSION = "draft-1";
/** The youngest age allowed to create an account; members confirm it when they accept. Change it for your application. */
export const MINIMUM_AGE = 18;

/** A member accepts the Terms and the Privacy Policy and confirms their age. Both boxes must be ticked. */
export const acceptLegalSchema = z.object({
  acceptTerms: z.literal(true, { error: "Tick this to continue" }),
  confirmAge: z.literal(true, { error: "Tick this to continue" }),
});
export type AcceptLegalInput = z.infer<typeof acceptLegalSchema>;

/** Deleting an account is permanent, so the member types this word to confirm. */
export const DELETE_CONFIRMATION = "DELETE";
export const deleteAccountSchema = z.object({
  confirm: z.string().refine((v) => v.trim().toUpperCase() === DELETE_CONFIRMATION, { error: `Type ${DELETE_CONFIRMATION} to confirm` }),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
