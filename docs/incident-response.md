# Incident response

What to do when something goes wrong in production: a security problem, a bad release, leaked data, an abusive person, or a vendor outage. **This is an engineering runbook, not legal advice.** If personal data may have been exposed, involve a lawyer early (section 5). It satisfies the pre-launch checklist item in `/docs/risk-and-legal.md` section 5. Keep it short enough to follow while stressed.

**First rule:** stop the harm, then investigate. Do not delete evidence (logs, deployments, database rows) until the problem is understood. Never paste a secret into a chat, an issue or a commit (`/CLAUDE.md` section 18).

**Keep this current.** Nothing is in production yet. Every feature that adds a vendor, a credential or a way to cause harm adds its off switch and its credential row here, in the same pull request.

## 1. Who decides and who to tell

| Role | Who | Does |
| --- | --- | --- |
| Incident owner | The owner | Decides, flips the off switches, talks to vendors and any lawyer |
| Helper | Claude (in a session) | Reads logs and code, drafts fixes and the write-up; **cannot** log in to vendor dashboards or approve production changes |
| Contact for the public | UNDECIDED: needs a monitored address before launch | Where reports arrive; the owner reads it |

Vendor status pages to check first when something is down: Vercel, Neon, Clerk, GitHub, and any vendor added since.

## 2. The off switches (fastest first)

Settings are in Vercel, in the project's Settings, Environment Variables, **Production**. A changed value only applies after a **redeploy** (Deployments, the latest one, Redeploy).

| To stop | Do this | Effect |
| --- | --- | --- |
| A bad release | Vercel, Deployments: choose the last good deployment and use Instant Rollback (promote it) | The previous version serves again |
| The whole site | Vercel, project Settings, pause the project (or remove the domain from the project) | The site stops answering; data is untouched |

## 3. Credentials: where each lives and how to replace it

Rotate a credential if it may have been seen by anyone else. Put the new value straight from the vendor page into Vercel; never through chat.

| Credential | Lives in | Replace by |
| --- | --- | --- |
| Clerk secret key and publishable key (production) | Vercel Production | Clerk dashboard (Production), API keys, roll; update Vercel; redeploy |
| `DATABASE_URL` (production) | Vercel Production, and the GitHub environment secret used by "Migrate production" | Neon, the production branch, reset the role password; update both; redeploy |
| GitHub Actions secrets (`NEON_DEV_DATABASE_URL`, `E2E_CLERK_*`) | GitHub, Settings, Secrets and variables | Replace at the vendor, then update the secret |

After rotating: confirm the site works, then check the vendor's activity log for use of the old credential.

## 4. Steps for any incident

1. **Contain** (section 2). Write down the time you did each thing.
2. **Understand:** what happened, since when, what was reachable. Vercel logs and deployments, Neon history and Clerk's activity show a lot. Ask Claude to read logs and code; never to run anything against production from a laptop.
3. **Fix** through the normal pull request flow, with a test that fails without the fix (`/CLAUDE.md` rule 12). In an emergency the rollback in section 2 comes first and the fix after.
4. **Tell** whoever must be told (section 5), in plain words, without speculating.
5. **Record** it in `/docs/lessons.md`: what happened, the root cause, and the guard that now prevents it. A repeat is a process failure.

## 5. If personal data may have been exposed

1. Contain first; keep logs. Do not edit or delete database rows to "tidy up".
2. Work out **which data** from `/docs/data-inventory.md` (tiers T1 to T4).
3. **Involve a lawyer** (breach-notification rules differ by state and country). Do not publish a statement before they have seen it.
4. Notify affected people and any required authority within the legal deadline, and tell the vendors whose systems were involved.
5. Offer what helps, such as a password reset through Clerk.

## 6. Practice

Before launch, rehearse one off switch and the database restore drill (`/docs/database.md` section 12.4), and record the result in `/docs/release.md`.
