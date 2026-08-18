# @opencrane/backend/server/iam/organization-members — member directory and invitations

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › organization-members

## What it owns

This identity and access management package owns the settings-facing organisation directory and the
full email-address invitation lifecycle. It runs after OpenID Connect (OIDC) has established the
person's subject, verified email, and host-selected silo. It returns the current members, validates
recipients, creates expiring links idempotently, rotates links on resend, and accepts a link only for
the signed-in identity whose provider verified the matching email.

```
 verified OIDC session + trusted host
                  │
                  ▼
 ┌──────────────────────────────────────┐
 │ organization-members  ◄── HERE       │
 │ directory · validate · invite · join │
 └──────────────────────────────────────┘
          │                       │
 standalone: local rows      fleet: billing gateway
```

**In this flow:** [identity](../../identity/main/README.md) establishes the session;
[membership](../../membership/main/README.md) separately verifies signed execution-membership
revisions and is not the settings directory.

The deployment chooses exactly one owner. Standalone mode uses the silo database and a mounted key
to authenticate shareable links. Fleet mode sends every read and mutation to a membership-and-billing
gateway through the server-infrastructure HTTP adapter. That adapter presents a rotating,
audience-bound ServiceAccount token; it has no local repository and cannot fall back when Fleet is
unavailable. A browser cannot select mode, silo, subject, or verified email.

Invariant: a local mutation rechecks active Owner or Admin state, every create and resend retry has a
stable idempotency outcome, and token possession never replaces verified-email matching. The database
also refuses any mutation that would remove, suspend, demote, or move the active owner.

Standalone product routes require an active membership after authentication. The exact signed
invitation-acceptance POST is the only pre-membership exception: it still binds the verified email,
stable subject, and trusted-host silo before creating the active row. Missing, suspended,
cross-silo, or unavailable membership fails closed. Fleet mode retains its existing remote-authority
path and does not install this local database gate.

## Public surface

- `_CreateOrganizationMembersRouter` serves the five authenticated directory and invitation routes.
- `_CreateOrganizationProductAccessMiddleware` admits active standalone members and the exact
  pre-membership invitation-acceptance POST.
- `StandaloneOrganizationMembershipAuthority` owns local validation, tokens, and projections.
- `FleetOrganizationMembershipAuthority` delegates the same API to Fleet and fails closed while the
  server-infrastructure adapter owns HTTP and projected-token mechanics.
- `PrismaOrganizationMemberUnitOfWork` opens each mutation transaction; its internal repository
  owns the transaction-scoped delegates.
- `HmacOrganizationInvitationTokenAuthority` reproduces signed links without storing bearer tokens.
- `_OrganizationMembersOpenapiPaths` and `_OrganizationMembersOpenapiSchemas` generate the shared client.
- Domain projections, commands, ports, deployment modes, and stable error enums are exported from `src/index.ts`.

## Boundary

The OpenCrane app supplies caller facts from the verified session and trusted host. The package does
not send email: create and resend return a server-authored shareable link. An email provider may be
added later behind a separate delivery port without changing invitation authority.

In Fleet mode OpenCrane checks the resolved silo matches startup config. Fleet must TokenReview the
projected token for the configured audience, require the expected OpenCrane server ServiceAccount,
and bind that identity to `X-OpenCrane-Silo-Id` before applying seat, plan, or payment rules. Unknown
Fleet error bodies and malformed success bodies fail as unavailable.

## Dependency direction

Tagged `scope:membership`: it depends on authentication-neutral Express types, Prisma at its declared
adapter, shared observability, and its own contracts. It never imports frontend or application source.

## Data & persistence

Owns `OrganizationInvitation` and `OrganizationInvitationRequest` in
`apps/opencrane/prisma/schema/organization-members.prisma`. It also writes the email and display-name
profile fields on the existing `OrgMembership` row created by acceptance. Fresh installs use the
target baseline; existing 0.8.0 databases use the reviewed `0.8.0-to-0.9.0` migration.

## Runtime & config

Standalone requires `OPENCRANE_INVITATION_SIGNING_KEY_PATH` and `OPENCRANE_PUBLIC_BASE_URL`; its
default link lifetime is seven days. Fleet requires one credential-free HTTPS gateway origin, silo
id, and mounted projected-token path. Both modes are selected by `OPENCRANE_MEMBERSHIP_MODE` at
server composition time.

## See also

- Parent index: [iam](../../README.md)
- Transport: [organization-membership-gateway](../../../infra/organization-membership-gateway/README.md)
- Siblings: [identity](../../identity/main/README.md) · [membership](../../membership/main/README.md) · [audit](../../audit/main/README.md)
