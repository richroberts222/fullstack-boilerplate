# Legal gate: terms, privacy, age, export and deletion (add-on)

Installed with `pnpm init:app --with=legal` (it brings `rate-limits` too). Status: reviewed in a production application (2026-11-18), then made generic. The wording of the Terms and the Privacy Policy is a **draft for a lawyer**; it is not legal advice and must be replaced before real members join (`/docs/risk-and-legal.md`).

## Need

Before the application takes real members, each member must have accepted the Terms and the Privacy Policy (with the version and the time recorded), confirmed the minimum age, and be able to download and delete their own data.

## How it works

- `/terms` and `/privacy` are public pages, marked as drafts, each showing its version (`TERMS_VERSION`, `PRIVACY_VERSION` in `packages/validation/src/legal.ts`). Change the version whenever the wording changes; every member is then asked again. `MINIMUM_AGE` (default 18) is in the same file.
- Sign-up is Clerk's own page, so acceptance comes right after it: `/dashboard` sends a member who has not accepted the wording in force to `/accept`. `/accept` has two boxes (the documents, and "I am at least N years old").
- The server enforces it where a member creates data or spends money: call `getPrivacyService().hasAccepted(userId)` in those services and throw `policyReacceptanceRequired()` (HTTP 403). Add-ons that charge money do this.
- "Your data" on `/dashboard`: **Download my data** (one JSON file: the account's name and email from Clerk, and every account data part) and **Delete my account** (type DELETE, then confirm).

## Account data parts

Every feature that stores a member's data adds a part to `apps/web/lib/legal/account-data.ts` (type `AccountDataPart` in `apps/web/db/legal.ts`): a name for the export, the tables it covers, its rows for the export, its deletion (or anonymization with a stated legal reason) statements, and an optional preparation step that runs before anything is deleted (for example stopping a plan that still bills; if it fails, nothing is deleted). Two guards keep this honest:

- `lib/legal/account-data.test.ts`: every table in `/docs/data-inventory.md` with a `user_id` or `owner_id` column is covered by a part.
- `app/privacy/privacy-coverage.test.ts`: every table with a T2 or T3 column is named on the Privacy Policy page.

Deletion: every part's preparation, then every part's statements in one atomic unit, then the Clerk account. If the Clerk step fails, the member's data is already gone and they can press Delete again.

## Acceptance criteria

- **AC1** Accepting records the member, the Terms version, the Privacy version, the minimum age confirmed and the time.
- **AC2** Only an acceptance of the versions in force counts; a newer version asks again.
- **AC3** Both boxes must be ticked (the schema refuses anything but `true` for each).
- **AC5** The export holds only the caller's own profile and rows.
- **AC6** Deletion prepares every part, deletes or anonymizes the member's rows only, then deletes the Clerk account.
- **AC7** If a part's preparation fails, nothing is deleted.
- **AC8** Deletion is refused without the typed confirmation.
- **AC9** `/terms` and `/privacy` are public and marked as drafts. Link both from the application's footer.
- **AC10** The accept page follows only a path on this site afterwards (no open redirect).
- **AC11** "Download my data" is rate limited (`export`: 5 an hour).

## Controls

| Screen | Control | Test id | Effect |
| --- | --- | --- | --- |
| `/terms`, `/privacy` | Draft notice, version, Privacy Policy link | `terms-draft`, `terms-version`, `terms-privacy-link`, `privacy-draft`, `privacy-version` | Display; the link opens `/privacy` |
| `/accept` | Accept the documents, confirm age, Continue, document links | `accept-form`, `accept-terms`, `accept-age`, `accept-submit`, `accept-terms-link`, `accept-privacy-link`, `accept-error` | Records the acceptance and goes on |
| `/dashboard` | Download my data; Delete my account (type DELETE) | `my-data`, `my-data-export`, `my-data-delete-form`, `my-data-delete-confirm`, `my-data-delete`, `my-data-error` | Downloads the JSON file; deletes after a confirm and goes home |

## Scope fence

In: the above. Out: the final wording (a lawyer), the contact address and governing law (owner), consent records for marketing email, the phone app's in-app deletion (store work), an audit entry for the deletion (the base has no audit table; add one in the application if it keeps an audit log).

## Done checklist

| Item | Proof |
| --- | --- |
| AC1 to AC3, AC5 to AC8 | `apps/web/lib/services/privacy.test.ts` |
| AC10 | `apps/web/lib/legal-gate.test.ts` |
| Coverage guards | `apps/web/lib/legal/account-data.test.ts`, `apps/web/app/privacy/privacy-coverage.test.ts` |
| AC9, AC11, controls | `apps/web/e2e/legal-gate.spec.ts` (needs the E2E secrets) |
| Data | Table `legal_acceptances` (`apps/web/db/addons/legal.ts`), rows in `/docs/data-inventory.md` |
