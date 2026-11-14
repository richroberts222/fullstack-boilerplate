# Risk and Legal

The legal gates, the compliance standards that do and do not apply, the accepted risks, and the pre-launch checklist. **This is an engineering checklist, not legal advice.** Items that need a lawyer, an accountant or the owner's signature are marked **Owner action**. Standards are named from established practice and should be confirmed against current publications and by counsel before they are relied on.

Security rules: `/docs/security.md`. Privacy-relevant data rules: `/docs/auth.md`, `/docs/database.md`. Every status below starts as **Not built**; update a row, with its proof, in the pull request that changes it.

## 1. The gates (nothing real until these exist)

| Gate | Rule | Status |
| --- | --- | --- |
| Collection gate | No real user data is collected until the privacy policy page, terms acceptance at sign-up, and the age confirmation exist | Not built |
| Age | A minimum age, confirmed by self-attestation at sign-up and recorded with the policy acceptance | UNDECIDED (the owner sets the age; 18 keeps children out of scope) |
| Terms and privacy | Generic Terms of Service and Privacy Policy first; acceptance (policy version and timestamp) recorded when the first user row is created; attorney review before launch | Not built |
| First non-US user | Legal review is required before the first user outside the United States, plus a decision on data location and vendor data-processing terms | Gate recorded |
| Payments | No payment feature until the payments rules (`/docs/payments.md`) are met and the store rules are checked | Not built; stays closed until these gates are met |
| Public launch | Everything in section 5 is complete | Not met |

## 2. Standards: what applies, what does not

| Standard | Applies? | Why | Action |
| --- | --- | --- | --- |
| WCAG 2.2 level AA, Section 508 (US federal accessibility), ADA expectations | **Yes, as the target** | Section 508 binds federal agencies and their vendors; WCAG 2.2 AA is the practical standard for any public product and the usual basis of accessibility claims | Adopt WCAG 2.2 AA as the written target; automated checks plus a screen-reader pass before launch; the iOS and Android equivalents for the apps |
| HIPAA (US health information) | **Not by default** | It applies to healthcare providers, health plans and their business associates | Do not collect health information. A feature that invites it is reviewed by counsel first; state consumer-health-data laws can apply even where HIPAA does not. Do not claim HIPAA compliance |
| FedRAMP, DoD STIGs, NIST SP 800-53 and 800-171 | **No** | They apply to selling to government or handling government data | Not adopted. NIST frameworks are used as references only; the secure-development practices follow the spirit of NIST SSDF |
| SOC 2, ISO 27001 | **Later, if asked** | Larger partners may require them | Revisit if a partner requires one |
| PCI DSS | **When taking payments** | Card data scope is avoided entirely by using the provider's hosted checkout | Hosted checkout only (`/docs/payments.md`) |
| COPPA (under-13 data) | Avoided | A minimum age keeps children out | Self-attestation plus no features aimed at children |
| GDPR, UK GDPR, CCPA/CPRA and other privacy laws | **Yes, as the product grows beyond the US** | They govern notice, consent, access, deletion and export | Build deletion, export and the data inventory from the first user table; region-specific work when a region opens |
| Employment and screening law (for example equal-opportunity rules, and rules on background or credit checks) | **Ask counsel before any feature that screens, ranks or verifies people for employment** | A product that handles candidates or hiring decisions can fall under rules that ordinary apps do not | Counsel review before the first such feature is specified; record the outcome here |
| CAN-SPAM and similar messaging rules | **When sending email or text** | Unsubscribe and sender identity | Part of the notifications rules (`/docs/integrations.md`) |
| DMCA / copyright takedown | **When users submit content** | A designated agent and a takedown process protect the platform | Page and process before user submissions go live |
| Apple App Store Review Guidelines, Google Play policies | **Yes, for the apps** | User-generated-content controls, in-app account deletion, privacy labels, in-app purchase rules | Checked at submission time |

## 3. Business and legal protections (Owner actions)

Most companies put these in place before launch. None is done by the repository.

| Item | Why | Who |
| --- | --- | --- |
| Business entity (for example an LLC) | Separates business liability from personal assets | Owner, with an accountant or lawyer |
| Terms of Service and Privacy Policy reviewed by an attorney | The generic documents are a starting point | Owner |
| Trademark search for "App Boilerplate" | Avoid a naming dispute after launch | Owner or lawyer |
| Business insurance (general liability, possibly cyber) | Covers claims and incidents | Owner |
| Copyright agent registration (for takedown notices) | Needed for DMCA safe-harbor | Owner |
| Vendor terms read for commercial use (Vercel plan, Clerk, Neon, Expo, payment provider) | A free tier may not permit commercial use | Claude checks and reports; the owner decides on any paid plan |
| Open-source license decision for this repository | No license means "all rights reserved"; publishing under an open license is irreversible for the published copies | **Undecided** by the owner. Default: no license file (all rights reserved) |

## 4. Accepted risks

None recorded for this application. An accepted risk is decided by the owner, written here with the event that reopens it, and not re-raised unless that event occurs.

| Risk | Decision | Revisit when |
| --- | --- | --- |
| (none yet) | | |

## 5. Pre-launch legal and risk checklist

Tick each item and record the proof before real users or real data. "Owner" marks what only the owner (or a lawyer) can do.

| # | Item | Status | Proof, or what is left |
| --- | --- | --- | --- |
| 1 | Terms of Service and Privacy Policy pages exist, are linked from sign-up, and acceptance (version and timestamp) is recorded | Not built | |
| 2 | The age confirmation exists at sign-up and is recorded | Not built | |
| 3 | Deletion and export of a user's data work end to end and are documented | Not built | `/docs/data-inventory.md` must list every column's deletion path |
| 4 | User-submitted content, if any: report, review and removal process; copyright takedown contact; content rules published | Not built | |
| 5 | WCAG 2.2 AA scan and a screen-reader pass completed; results recorded | Not done | |
| 6 | A dependency license scan found nothing that forbids commercial use; the result is recorded in section 8 | Not done | Run `pnpm licenses list` |
| 7 | Vendor terms checked for commercial use; paid plans chosen where required (owner approval) | Not done | Section 8 |
| 8 | Incident response page exists (who to contact, how to shut things off, credential list) | Drafted | `/docs/incident-response.md`. Left: the public contact address, and rehearsing one off switch |
| 9 | Backups and a restore drill completed | Not done | Run on a non-production database branch |
| 10 | Production Clerk instance and domain set up | Not done | |
| 11 | For the apps: store privacy answers, account deletion in-app, user-generated-content controls | Not started | Needs a store account |
| 12 | Owner actions in section 3 completed or consciously deferred, with the decision recorded | Open | |

## 6. Enforcement and proof status

| Rule | Mechanism | Proof |
| --- | --- | --- |
| No secrets or credential-shaped values in committed files | `security.test.ts` | Enforced in every `pnpm validate` run |
| Dependency vulnerabilities are known and handled | Dependabot; `pnpm audit` | Check that Dependabot is enabled on the new repository |
| Dependency licenses allow commercial use | `pnpm licenses list` scan, result in section 8; rerun before launch | Not done |
| The collection gate, age confirmation, terms acceptance, deletion and export | Built per feature; tests at every layer | Not built |
| Items in sections 3 and 5 that are owner actions | Checklist only | n/a |

## 7. Policy wording to add when a feature goes live

The Privacy Policy and Terms must be accurate for what is switched on. When a feature stores or shares more than the policy says (a contact form, payments, email, phone alerts, a new vendor), add its paragraph, and bump the policy version so every user is asked to accept again, **in the same change that turns the feature on**. Draft the wording for the owner and a lawyer to review; it is not final until they approve it. The policy lists every service that handles user data and what each does.

**Decisions only the owner can make:** retention periods for anything users send us; the refund policy; the legal name and address in the Terms; whether to register a copyright agent.

## 8. Dependency licenses and vendor terms

Not yet checked for this application. Before launch, run `pnpm licenses list`, record the counts and any package with a copyleft or unusual license (an AGPL, SSPL, proprietary or non-commercial license would block commercial use), and read each vendor's own Terms page for commercial use.

| Vendor | What to confirm | Left for the owner |
| --- | --- | --- |
| Vercel | The Hobby plan is non-commercial; a paid plan is needed for commercial use | Choose a plan before launch |
| Neon | Whether the free plan permits commercial use; a paid plan is a go-live consideration (`/docs/release.md`) | Read Neon's Terms |
| Clerk | Whether the free plan permits commercial use, and its monthly active user limit | Read Clerk's Terms |
| Expo (EAS) | Free build quotas and fair-use policy | Check when the first build is needed |
| Payment provider | Live use needs a business account and its terms (`/docs/payments.md`) | Open the live account only after the gates |
| GitHub | Free for a public repository; check private-repository limits for automatic checks | Check plan limits |
