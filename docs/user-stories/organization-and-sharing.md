# Organisation and sharing user stories

## Feature intent

Let an organisation understand membership, groups, entitlements, resources, and effective access
without letting the browser become an identity or authorization authority.

Current status: `API partial`, `UI partial`. Group and sharing APIs exist, and the member invitation
journey now runs behind one deployment-neutral contract. The remaining role, suspension, removal,
and effective-access journeys are still incomplete. Group mutations need role/silo hardening before
exposure.

## ORG-01 — See my organisation and role

**As a** signed-in user, **I want** to see my active ClusterTenant and organisation roles **so that** I
understand the authority behind the current surface.

API: `GET /api/v1/auth/me`.

## ORG-02 — Manage groups

**As an** organisation admin, **I want** to create, inspect, update, and delete hierarchical groups **so
that** access policies can target meaningful sets of people.

Acceptance criteria:

- Group fields include name, optional description, nullable parent, membership authority, and members.
- A parent supplies hierarchy without creating implicit membership.
- External groups mirror login claims; local groups remain operator-curated.
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
- An invitation starts with a normalized email address but gains authority only when a signed-in
  person proves the exact verified email and the server binds the invitation to that stable OIDC
  subject. Email is never used as the durable member identity.
- Creating or resending an invitation is idempotent, rotates the bearer invitation secret, and
  invalidates the previous secret. Expired, replayed, wrong-email, wrong-silo, and already-consumed
  secrets fail closed.
- A successful invitation returns a server-authored shareable link. The UI may claim that an email
  was sent only when the selected delivery gateway reports that outcome; link creation by itself is
  never presented as email delivery.
- The browser calls the same organisation-member API in every deployment and never chooses the
  membership authority, silo, subject, payment state, or seat policy.

Deployment authority:

- In `standalone` mode, OpenCrane owns the invitation record and the local membership transition.
- In `fleet` mode, OpenCrane delegates directory reads and every invitation mutation to the
  configured Fleet membership-and-billing gateway. Fleet may enforce paid seats and issue the
  signed membership revision consumed by the silo.
- A missing, unavailable, or invalid Fleet gateway never falls back to standalone writes. The
  management journey becomes dependency-unavailable while existing signed membership checks keep
  failing closed under their normal expiry and high-water rules.

Target APIs: `GET /api/v1/organization/members`, recipient validation and invitation creation under
`POST /api/v1/organization/members/invitations`, resend under
`POST /api/v1/organization/members/invitations/{invitationId}/resend`, and verified-person adoption
under `POST /api/v1/organization/members/invitations/accept`.

Status: `API ready`, `UI ready` for standalone directory reads, invitation creation, link refresh,
and verified-email acceptance. The fail-closed Fleet delegation client is ready, but Fleet payment
refusal remains receiver-gated until Fleet/WeOwnAI implements and qualifies the membership-and-billing
endpoint. Role changes, suspension, removal, and ownership transfer remain separate incomplete slices.
Fleet's older subject-based member upsert is not an invitation API and is not used by this journey.

## ORG-04 — Share a resource

Status: `Unavailable`. OpenCrane has no authoritative creation lifecycle for a file, chat, or dataset
share. The former migrated-share list and revocation compatibility API is not a current product
surface in the clean 0.10 target.

**As a** resource member, **I want** to share a file, chat, or dataset with an authorised recipient
**so that** collaboration does not copy authority into browser state.

Acceptance criteria:

- Resource types are `file`, `chat`, and `dataset`.
- The UI distinguishes owner authority, the exact recipient Principal, existing share, revoked, and inaccessible.
- Creation remains absent until each resource lifecycle exposes authoritative ownership.
- A future implementation must create and revoke the exact recipient grant in the same central
  authorization transaction as its owning resource relation.

## ORG-05 — Explain effective access

**As a** user or administrator, **I want** to understand why a person can access a tool, resource, or
agent **so that** principal, group, exact-boundary, and descendant-boundary grants are reviewable.

Acceptance criteria:

- Explanation identifies the safe grant path without exposing unrelated subjects or policy secrets.
- Current, revoked, stale-membership, and denied explanations are distinguishable.

Status: `API blocked`; no general effective-access explanation endpoint exists.
