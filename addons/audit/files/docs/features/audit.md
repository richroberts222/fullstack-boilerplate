# Audit add-on

Owner settings and the audit trail, taken by the `payments` add-on (and any app that wants them).

* `site_settings`: one row per owner setting (key, JSON value). An unknown or retired key is ignored.
* `audit_events`: who (an owner's user id) changed what, when, with the prior and new value. Rows are kept 2 years.
* `db/settings.ts`: `createSettingsRepo` and `createAuditRepo`. An audit row is written in the same atomic unit as the change it records (`lib/services/atomic.ts`).

Data rows: `docs/data-inventory.md`, section "Settings and audit (add-on)".
