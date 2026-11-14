# User Permissions and Roles

Who may do what, how roles are granted, and how every permission is checked. Authentication (who someone is) is in `/docs/auth.md`; the check primitives are `authorize()`, `isOwner()`, `anyOf()` and `allOf()` in `apps/web/lib/auth/`.

**Standards followed** (established practice; confirm before citing externally): OWASP ASVS V4 (access control), OWASP API Security Top 10 (API1 object-level and API5 function-level authorization), role-based access control (NIST RBAC model), least privilege, deny by default.

**Status:** the rules in section 2 are decided. The roles in section 1 are **UNDECIDED**: no role table, no grant flow and no admin list exist yet. They are decided in the first feature specification that needs one, by the owner.

## 1. Roles (UNDECIDED)

| Role | Meaning | How it is granted |
| --- | --- | --- |
| **Signed-in user** | An ordinary authenticated user | Automatic on sign-up; no approval |
| Further roles | UNDECIDED | UNDECIDED |

Do not invent roles. When a feature needs one, the specification names it, says how it is granted, and the owner approves it before it is built.

## 2. Rules

1. **Deny by default.** A rule that is missing, throws or returns anything but `true` denies (already implemented in `authorize()`). A new endpoint or action with no rule is a defect.
2. **Roles live in the application database,** keyed by the Clerk user id, never in the browser and never in a client-supplied value. Clerk proves who someone is; the database says what they may do.
3. **A user never chooses their own role.** A request creates a pending row; an approval by an authorized person creates the grant. Approval and revocation are restricted and recorded.
4. **Check on the server, in the service, on every request,** against the resource, not just the role ("is this person the owner of *this record*"). Hiding a button is not a check. Route protection in `proxy.ts` is authentication only.
5. **Least privilege.** Each action requires the narrowest role that can perform it. Admin is not a shortcut for every check.
6. **Audit what matters.** Role grants and revocations, approvals, moderation decisions and deletions record who, what, when and the prior state.
7. **No role is trusted from the token alone.** If roles are ever copied into session claims for convenience, the server still loads the role from the database for sensitive actions.
8. **Any admin allow-list is configuration, not code.** Changing who is an admin is an environment change by the owner, never a code change and never a client option.

## 3. Permission table (to complete per feature)

Each feature specification includes a permission table in this shape:

| Action | Role A | Role B | Admin |
| --- | --- | --- | --- |
| (action) | Yes / No | Yes / No | Yes / No |

## 4. Testing

* Every protected action has a **denial test for each role below the required one** plus a test for the wrong owner (an object-level check). Both are acceptance criteria in the feature (`/docs/qa-strategy.md`).
* Deny-by-default test: a rule that throws or returns a non-`true` value denies.
* A test fails if a new top-level route has no protection decision (`proxy.test.ts`).

## 5. Enforcement and proof status

| Rule | Mechanism | Proof |
| --- | --- | --- |
| Deny by default; ownership from the trusted actor | `authorize()` tests | Covered by the unit tests in `lib/auth/` |
| Every top-level route has a protection decision | `proxy.test.ts` | Removing the protection pattern fails the protected-path tests |
| Roles in the database, request then approve, audit trail | Not built | Applies when the first role-based feature is specified |
| A denial test per role per protected action | Feature acceptance criteria | Applies when features exist |
