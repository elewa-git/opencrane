# @opencrane/features/settings — organisation settings screens

> [frontend](../../README.md) › [features](../README.md) › settings

## What it owns

This feature owns the responsive settings frame, its navigation, the member directory, the
invitation form, and the public invitation-acceptance screen. The routed page coordinates separate
directory, create, resend, and acceptance stores; presentational components receive one mapped view
model and emit user intents.

```
 /settings/members ──► settings shell ──► members route  ◄── HERE
                                             │ intents and view state
                                             ▼
                              organisation-members state port

 /invite?token=… ──► invitation acceptance ──► acceptance store
```

**In this flow:** [organisation-members state](../../state/organization/members/README.md) owns
browser command state and the gateway port.

The feature never decides whether a caller may invite, whether an external address is allowed, or
whether payment is required. It displays server-authoritative success and refusal states, including
a payment-required refusal supplied by Fleet or another host.

## Public surface

- `SETTINGS_ROUTES` — lazy child routes for the settings shell and member directory.
- `OrganizationInviteAcceptanceComponent` — public token-acceptance route component.

## Boundary

Consumed by `opencrane-ui`. It owns routing and presentation only; the backend remains the authority
for roles, invitations, membership, expiry, identity matching, and host payment policy.

## Dependency direction

Tagged `scope:organization-members`, `frontend-role:feature`, `layer:frontend`, and `type:lib`. It
may consume shared elements and organisation-member state, but not adapters, backend code, or other
features.

## See also

- Parent index: [features](../README.md)
- State port: [organisation members](../../state/organization/members/README.md)
- App entrypoint: [opencrane-ui](../../../../apps/opencrane-ui/README.md)
