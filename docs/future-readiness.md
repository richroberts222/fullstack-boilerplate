# Future Readiness

Planning for growth without building it early. This document records (1) where the platform may be heading (no product plan exists yet), (2) the standards larger customers and partners usually ask for, (3) the cheap decisions made now so options stay open, and (4) what waits for a trigger. **Nothing here authorizes building anything.** Only an approved issue authorizes work.

Standards are named from established practice and should be confirmed against current publications before they are cited externally. Anything that costs money needs the owner's approval first.

## 1. Where the platform may be heading

Nothing is decided. The owner records a direction here only after approving it; until then every row is UNDECIDED.

| Direction | Source | What it implies for the platform |
| --- | --- | --- |
| Web, iPhone and Android clients on one backend | Architecture (`/docs/architecture-rules.md`) | One backend, three clients |
| Launch market and worldwide use | UNDECIDED | Time zones, languages, regional privacy law |
| Further products and phases | UNDECIDED | More roles, payments, media, content volume |

## 2. What larger customers and partners usually ask for

None is required today. Each has a trigger.

| Ask | Standard or practice | Trigger | Platform readiness now |
| --- | --- | --- | --- |
| Single sign-on for an organization (SAML or OpenID Connect, user provisioning) | Enterprise identity (SAML, OIDC, SCIM) | A large customer asks | Clerk offers enterprise connections (a paid tier; verify and ask first); identity stays in Clerk |
| Security attestation | SOC 2 Type II, ISO 27001 | A partner requires it | Controls are documented and tested (`/docs/testing.md`); a formal audit is a business decision |
| Accessibility conformance report | WCAG 2.2 AA, VPAT | A government, school or large-organization customer | Target stated (`/docs/risk-and-legal.md`); nothing measured yet |
| Data processing agreement and privacy rights | GDPR, UK GDPR, CCPA | First non-US user | Deletion, export and the data inventory are decided from the first user table |
| Uptime commitment and incident process | SLA, status page, incident response | Paid plans or partner contracts | Monitoring and rollback not built |
| Penetration test report | Third-party pen test | A partner or the public launch | Planned layers in `/docs/qa-strategy.md` section 7 |
| Audit trail of administrative actions | Audit logging | Any admin or moderation feature | Decided in `/docs/permissions.md`; not built |
| Software bill of materials and license compliance | SBOM, open-source license policy | A partner asks, or before the template is shared | Dependency license scan planned (`/docs/risk-and-legal.md`) |
| Partner and developer access to the API | API keys, rate limits, webhooks | A partner integration | Versioned API in place; keys and limits not built |

## 3. Cheap decisions made now so options stay open

| Decision | Why it is cheap now and expensive later | Where it lives |
| --- | --- | --- |
| Every organization-owned and user-owned row carries its owner or organization id; permissions are checked against the resource | Retrofitting multi-organization data is a migration of every table | `/docs/permissions.md`, `/docs/data-mutations.md` |
| Time zones, recurrence, money (integer minor units plus currency) and units are decided before the first table that stores them | A wrong convention is baked into every row | `/docs/data-fetching.md`, `/docs/data-mutations.md` gates |
| User-facing text and date and number formatting stay out of business logic and use locale-aware formatting | Translation later becomes a text-extraction exercise, not a rewrite | `/docs/ui.md`; translation itself is deferred |
| Each application built from the template gets its own deployment and database | Avoids a shared multi-tenant database with its isolation risks | `/docs/new-app-setup.md` |
| Vendors sit behind ports with one adapter folder | A vendor can be replaced without touching business logic | `/docs/code-quality.md` section 12, `/docs/integrations.md` |
| The API is versioned and additive-only inside a version | Old mobile apps keep working while the platform grows | `/docs/api.md`, `/docs/release.md` |
| The first sensitive action records an audit entry (who, what, when, prior state) | Audit history cannot be reconstructed afterward | `/docs/permissions.md` |
| Region choice is explicit: the database region is recorded and matches the functions region | Moving data between regions later is a migration with downtime | `/docs/deployment.md` |

## 4. Deliberately deferred (build only at the trigger)

| Item | Trigger |
| --- | --- |
| Translation into other languages | The first non-English market is chosen |
| Background jobs and queues (email, push, imports) | The first feature that must run outside a request |
| Search service beyond PostgreSQL | Search quality or load requires it |
| Caching layer, read replicas, content delivery for media | Measured performance or load needs, with a budget (`/docs/qa-strategy.md`) |
| Multi-region deployment | A second region's users or a legal requirement |
| Any product phase beyond the first | Each phase is approved by an issue and a specification |
| Paid single sign-on, SOC 2 audit, pen test, status page | A partner requires it; the owner approves the spend |

## 5. Gaps an independent review raised, now tracked

| Gap | Handling |
| --- | --- |
| Monitoring, error tracking and alerting | Decide before launch; owner approves any paid service |
| What is logged server-side, and personal data in logs | A logging rule is written with the first logging feature; secrets and tokens are never logged (`/docs/security.md`) |
| Data retention schedule | Decided with the privacy policy and the first user table |
| Performance budgets (page weight, API latency) | Set with the first real feature and measured in the browser test job |
| Cross-site request forgery and cookie settings for server actions | Reviewed with the first server action; headers and cookie attributes with the security-header work |
| Backups and a restore drill | Ranked above several High-rated rules in priority |
| Mobile token storage and deep-link validation | Part of the walking skeleton's design review |

## 7. How this document is used

* Before designing a feature, check section 3: does the feature touch a decision that must be made now?
* When a partner or customer asks for something in section 2, treat it as a trigger: open an issue, estimate, and bring any spending to the owner.
* When something here is built, move it to the owning document and delete the row.
