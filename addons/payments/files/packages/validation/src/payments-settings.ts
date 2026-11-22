import { z } from "zod";

// Payments settings (/docs/features/payments.md). Every open product choice is a setting with a safe default.
// A setting that was never saved reads as its default, and a stored value that no longer passes its schema also
// falls back to the default, so a bad row can never break the site. The application keeps these rows in
// `site_settings` (audit add-on) next to its own settings.

/**
 * A whole number of days. Forms send text, so digits are accepted as text too; an empty or non-numeric
 * value is refused (never read as 0, which would silently remove a grace period).
 */
function wholeDays(min: number, max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v),
    z.number({ error: "Enter a whole number of days" }).int("Whole days").min(min, `At least ${min}`).max(max, `At most ${max}`),
  );
}

export const paymentsSettingSchemas = {
  /** Days a member keeps full access after a payment stops (grace period). */
  gracePeriodDays: wholeDays(0, 365),
  /** Days "Remind me in a few days" hides the grace banner. */
  reminderSnoozeDays: wholeDays(1, 30),
  /** Whether signed-in members without the upgraded tier see that bonus content exists, with an upgrade link. Visitors never do. */
  showLockedBonus: z.boolean(),
  /** Free days before a member's first monthly plan starts charging. 0 means no trial. Only a first purchase gets one. */
  trialDays: wholeDays(0, 90),
  /** Days after a purchase in which a member may ask for a full refund. 0 means all sales are final. */
  refundWindowDays: wholeDays(0, 60),
} as const;

export type PaymentsSettingKey = keyof typeof paymentsSettingSchemas;
export type PaymentsSettings = { [K in PaymentsSettingKey]: z.output<(typeof paymentsSettingSchemas)[K]> };

export const PAYMENTS_SETTING_DEFAULTS: PaymentsSettings = {
  gracePeriodDays: 30,
  reminderSnoozeDays: 3,
  showLockedBonus: true,
  trialDays: 0,
  refundWindowDays: 14,
};

export const PAYMENTS_SETTING_KEYS = Object.keys(paymentsSettingSchemas) as PaymentsSettingKey[];

/** An owner update: any subset of these settings, each validated by its own schema. Unknown keys are refused. */
export const updatePaymentsSettingsSchema = z
  .object(Object.fromEntries(PAYMENTS_SETTING_KEYS.map((k) => [k, paymentsSettingSchemas[k].optional()])) as { [K in PaymentsSettingKey]: z.ZodOptional<(typeof paymentsSettingSchemas)[K]> })
  .strict();
export type UpdatePaymentsSettingsInput = z.infer<typeof updatePaymentsSettingsSchema>;

/** Builds the full payments settings from stored rows: defaults for anything missing, unknown or invalid. */
export function resolvePaymentsSettings(rows: readonly { key: string; value: unknown }[]): PaymentsSettings {
  const out: Record<string, unknown> = { ...PAYMENTS_SETTING_DEFAULTS };
  for (const { key, value } of rows) {
    if (!(key in paymentsSettingSchemas)) continue;
    const parsed = paymentsSettingSchemas[key as PaymentsSettingKey].safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as PaymentsSettings;
}
