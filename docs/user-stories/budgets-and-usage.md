# Budget and usage user stories

## Feature intent

Let authorised administrators set bounded spend ceilings and understand attributable token usage
without exposing other users or presenting stale calculated alert states as authority.

Current status: `API partial`, `UI missing`, `Needs decision`. Runtime and OpenAPI schemas disagree,
and the routes currently lack appropriate role/silo authorization.

## BUD-01 — Set the global AI budget

**As an** authorised administrator, **I want** to set a currency and global ceiling **so that** run
admission has an explicit spend boundary.

Acceptance criteria:

- The editable contract is `currency` plus non-negative `ceilingAmount`.
- Read, save-in-progress, saved, validation, conflict, forbidden, and unavailable states are covered.
- A zero ceiling has an explicit product meaning rather than an accidental default.
- Mutation success accepts a `204 No Content` response.

APIs: `GET/PUT /api/v1/ai-budget/global`.

Status: `API partial`; OpenAPI incorrectly advertises `monthlyLimitUsd` and 200 response bodies.

## BUD-02 — Set or remove an account budget

**As an** authorised administrator, **I want** to set or remove a user's ceiling **so that** personal
admission can resolve the correct effective budget.

Acceptance criteria:

- The subject is selected from authoritative membership data, not arbitrary free text.
- The UI explains how account and global ceilings resolve.
- Removal, inherited ceiling, no membership, forbidden, and concurrent update states are designed.

APIs: `GET /api/v1/ai-budget/accounts`, `PUT/DELETE .../accounts/{userId}`.

Status: `API partial`; member discovery is missing and authorization must be hardened.

## BUD-03 — Review token usage and cost

**As an** authorised administrator, **I want** to review per-user input, output, total tokens, cost,
currency, and resolved ceiling **so that** I can identify consumption patterns.

Acceptance criteria:

- Currency and calculation window are explicit.
- Empty, partial accounting, unavailable, zero usage, over ceiling, and inaccessible-user states are
  covered.
- Other users' usage is never available to an ordinary authenticated session.

API: `GET /api/v1/token-usage`.

Status: `API partial`; the route is undocumented and not adequately role/silo protected.

## BUD-04 — Receive meaningful budget warnings

**As a** user or administrator, **I want** warning and exceeded states derived from authoritative
ceilings and usage **so that** I understand why admission may be limited.

Status: `API blocked`; the OpenAPI-only `ok|warning|exceeded` shape does not match current runtime
responses and must not be treated as implemented.
