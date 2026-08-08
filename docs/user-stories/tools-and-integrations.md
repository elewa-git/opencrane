# Tools and integrations user stories

## Feature intent

Let users discover entitled tools and let administrators govern them, while keeping credentials in
an external custody boundary and distinguishing metadata configuration from executable readiness.

Current status: `API partial`, `UI early`, `Needs decision` around the retained legacy registry. The
present credential and OAuth routes must not be designed as verified connection success.

## TOL-01 — Browse my entitled tool catalogue

**As a** user, **I want** to browse published tools I am entitled to use **so that** I can understand
what capabilities are available.

Acceptance criteria:

- Catalogue results are filtered by published state and effective entitlement.
- Tool type distinguishes `single-user`, `multi-user`, and `remote-oauth`.
- Empty, loading, unavailable, installed, not installed, and access-lost states are defined.

API: `GET /api/v1/mcp/catalog`.

## TOL-02 — Install and uninstall a tool

**As a** user, **I want** to install or remove an entitled tool **so that** it appears in my personal
tool set only while I choose to use it.

Acceptance criteria:

- Installation revalidates published state and entitlement by ID.
- Initial connection state is truthful: `needs-credential`, `shared-key`, or another server-derived
  state.
- Uninstall explains whether credentials, OAuth grants, or pending actions are affected.

APIs: `GET/POST /api/v1/mcp/installed`, `DELETE /api/v1/mcp/installed/{serverId}`.

Status: `API partial`; direct install currently does not fully enforce publication/entitlement.

## TOL-03 — Supply write-only credentials

**As a** user, **I want** to submit the credentials a tool requires **so that** they are placed into
approved custody without ever being returned to the browser.

Acceptance criteria:

- The schema names required fields and marks values write-only.
- Reads return configured/not-configured, last verification, and readiness only.
- Validation, custody unavailable, rejected credential, activation pending, verified, failed, and
  disconnect states are finite.
- A random reference without custody verification is never labelled connected.

APIs: `PUT/DELETE /api/v1/mcp/installed/{serverId}/credential`.

Status: `API blocked` for a truthful handshake; submitted values are currently discarded.

## TOL-04 — Connect with OAuth

**As a** user, **I want** to authorize a remote tool through its provider **so that** OpenCrane can
use a revocable grant without seeing my password.

Acceptance criteria:

- The flow has explicit start, external redirect, callback, state/nonce validation, grant custody,
  verification, connected, denied, expired, revoked, and failed states.
- The callback is bound to the user, silo, installation, provider and one-time state.
- No OAuth token or refresh token is returned through ordinary product reads.

APIs currently named `POST/DELETE /api/v1/mcp/installed/{serverId}/oauth`.

Status: `API blocked`; POST currently performs no provider OAuth exchange.

## TOL-05 — Govern catalogue publication

**As an** organisation admin, **I want** to review, approve, publish, reject, or disable catalogue
entries **so that** users discover only governed tools.

Acceptance criteria:

- The lifecycle is finite and predecessor transitions are enforced.
- Actions explain user-install and active-agent consequences.
- Concurrent and already-applied transitions do not silently overwrite newer governance.

APIs: `/api/v1/mcp/servers/{id}/approve|publish|reject|enabled` and admin list/directory routes.

## TOL-06 — Configure tool access policy

**As an** organisation admin, **I want** to make a published tool available to everyone or selected
groups/users **so that** entitlement matches organisational policy.

Acceptance criteria:

- Policy supports everyone-in-org, groups, and users with explicit inclusive semantics.
- Effective-access preview distinguishes direct, group-derived, and organisation-wide access.
- Removing access explains effects on existing installs and future run admission.

APIs: `GET/PUT /api/v1/mcp/servers/{id}/access`.

## TOL-07 — Provision an integration into Obot custody

**As an** organisation admin, **I want** to provision write-only integration credentials into Obot
**so that** OpenCrane stores only an opaque custody reference.

Acceptance criteria:

- The server verifies same-silo active integration and exact catalogue binding before contacting
  Obot.
- Inputs support one to 64 named write-only credential values.
- Results distinguish provisioned, failed, and compensation-failed without returning secret material.
- Obot unavailable fails closed.

API: `POST /api/v1/integrations/{integrationId}/custody`.

Status: `API partial`; there is no public integration list/create/lifecycle API around this route.

## TOL-08 — Use an installed tool during a run

**As a** user, **I want** an installed and authorized tool to execute through the run's frozen
allow-list **so that** connection metadata corresponds to real capability.

Acceptance criteria:

- Readiness requires custody, exact integration assignment, allowed tool, runtime transport, and any
  required approval.
- Unavailable transport is a visible failed/unavailable state, never fake success.
- The UI shows digest-safe receipts rather than credentials or proof material.

Status: `API blocked` in the current production composition; the external-action runner uses an
unavailable Obot invocation adapter.
