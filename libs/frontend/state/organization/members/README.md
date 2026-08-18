# @opencrane/state/organization/members — member and invitation state

> [frontend](../../../README.md) › [state](../../README.md) › [organisation](../README.md) › members

## What it owns

This package defines the browser-side port for reading an organisation directory, validating and
creating invitations, refreshing an invitation link, and accepting an invitation. Four independent
stores own those lifecycles so a read refresh cannot erase an in-flight command and one command
failure cannot contaminate another.

```
 settings feature ──intents──► directory · create · resend · acceptance stores
                                      │             ◄── HERE
                                      ▼
                              members gateway port
                                      ▲
                                  live adapter
```

**In this flow:** the [settings feature](../../../features/settings/README.md) owns presentation;
the [adapter](./adapter/README.md) implements the live HTTP transport.

Stores preserve successful mutation results while the directory catches up, reuse an idempotency
key for an unchanged retry, and convert typed server failures into safe display copy. They do not
calculate seat availability, payment plans, invitation expiry, or access policy.

## Public surface

- `ORGANIZATION_MEMBERS_GATEWAY` and `OrganizationMembersGateway` — injectable transport port.
- `OrganizationMemberDirectoryStore` — directory load, refresh, and retained-data state.
- `OrganizationInvitationCreateStore` — validation, creation, retry identity, issues, and links.
- `OrganizationInvitationResendStore` — per-invitation refresh-link state.
- `OrganizationInviteAcceptanceStore` — public-token acceptance lifecycle.
- Member, invitation, command, error, and gateway enums and interfaces — stable feature vocabulary.

## Boundary

Consumed by settings presentation and implemented by the sibling adapter. The backend remains the
only membership, role, invitation, identity, and payment-policy authority; unknown errors fail to a
generic message.

## Dependency direction

Tagged `scope:organization-members` and `frontend-role:state`. It may depend on shared frontend
primitives, but never on the feature, adapter, app, or backend packages.

## See also

- Parent index: [organisation state](../README.md)
- Live adapter: [members adapter](./adapter/README.md)
- Consumer: [settings feature](../../../features/settings/README.md)
