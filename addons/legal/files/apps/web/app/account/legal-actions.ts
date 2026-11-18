"use server";

import { acceptLegalSchema, deleteAccountSchema } from "@app-boilerplate/validation";
import { z } from "zod";

import { act } from "@/lib/actions";
import { getPrivacyService } from "@/lib/addons/legal";

// The legal gate's member actions (/docs/features/legal-gate.md): accept the Terms, download my data,
// delete my account. Each acts only on the caller.

export const acceptLegal = async (raw: unknown) => act(acceptLegalSchema, raw, (c, i) => getPrivacyService().accept(c, i));
export const exportMyData = async (raw: unknown) => act(z.object({}).strict(), raw, (c) => getPrivacyService().exportMyData(c), { limit: "export" });
export const deleteMyAccount = async (raw: unknown) => act(deleteAccountSchema, raw, (c, i) => getPrivacyService().deleteMyAccount(c, i));
