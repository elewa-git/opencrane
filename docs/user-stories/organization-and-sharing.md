# Organisation and sharing user stories

## Feature intent

Let an organisation understand membership, groups, entitlements, resources, and effective access
without letting the browser become an identity or authorization authority.

Current status: `API partial`, `UI missing`. Group and sharing APIs exist; membership management and
effective-access explanation do not. Group mutations need role/silo hardening before exposure.

## ORG-01 — See my organisation and role

**As a** signed-in user, **I want** to see my active ClusterTenant and organisation roles **so that** I
understand the authority behind the current surface.

API: `GET /api/v1/auth/me`.

## ORG-02 — Manage groups

**As an** organisation admin, **I want** to create, inspect, update, and delete scoped groups **so
that** access policies can target meaningful sets of people.

Acceptance criteria:

- Group fields include name, scope, optional description, and members.
- Scope is one of `org`, `department`, `project`, or `personal`.
- Empty, memberless, long-name, validation, conflict, forbidden, and delete-impact states are covered.
- Cross-silo groups are not listable or addressable.

APIs: `GET/POST /api/v1/groups`, `GET/PUT/DELETE /api/v1/groups/{id}`.

Status: `API partial`; runtime shapes differ from OpenAPI and route-level admin/silo enforcement is
insufficient.

## ORG-03 — Invite and manage members

**As an** organisation admin, **I want** to invite, change role, suspend, reactivate, and remove
members **so that** organisation access follows accountable lifecycle decisions.

Acceptance criteria:

- Every action is subject/issuer-bound and audited.
- The last Owner cannot be removed without an explicit safe ownership transfer.
- Invite, pending, active, suspended, removed, expired, and failed states are finite.

Status: `API blocked`; there is no public membership-management API.

## ORG-04 — Share an MCP entitlement

**As a** holder of an MCP entitlement, **I want** to share it with a user or group at an allowed scope
**so that** I can delegate capability I actually possess.

Acceptance criteria:

- Recipient type is `user` or `group`; scope is `org`, `department`, `project`, or `personal`.
- The server proves the caller holds the entitlement before creating the share.
- Identical replay is idempotent; revocation is creator-authorized.

APIs: `GET/POST /api/v1/shares`, `DELETE /api/v1/shares/{id}`.

## ORG-05 — Share a resource

**As a** resource member, **I want** to share a file, chat, or dataset with an authorised recipient
**so that** collaboration does not copy authority into browser state.

Acceptance criteria:

- Resource types are `file`, `chat`, and `dataset`.
- The UI distinguishes owner/member authority, recipient, existing share, revoked, and inaccessible.
- Revocation names the group and recipient subject exactly.

APIs: `GET/POST /api/v1/resource-shares`, `DELETE .../{groupId}/recipients/{subject}`.

## ORG-06 — Explain effective access

**As a** user or administrator, **I want** to understand why a person can access a tool, resource, or
agent **so that** direct, group, scope, and organisation-wide grants are reviewable.

Acceptance criteria:

- Explanation identifies the safe grant path without exposing unrelated subjects or policy secrets.
- Current, revoked, stale-membership, and denied explanations are distinguishable.

Status: `API blocked`; no general effective-access explanation endpoint exists.
