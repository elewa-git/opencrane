# @opencrane/state/organization/members/adapter — live member API adapter

> [frontend](../../../../README.md) › [state](../../../README.md) › [organisation](../../README.md) › [members](../README.md) › adapter

## What it owns

This package implements the organisation-member gateway with OpenCrane's generated signed-in HTTP
client. It maps wire responses into the state port's stable models and translates structured server
errors, including a host-owned payment requirement, into typed browser error kinds.

```
 members stores ──gateway calls──► live adapter  ◄── HERE
                                      │ generated request and response types
                                      ▼
                           /api/v1/organization/members
```

**In this flow:** [members state](../README.md) owns the transport-neutral port; the OpenCrane server
owns the API and all invitation authority.

The adapter sends a caller-supplied idempotency key on create and refresh-link commands. It never
manufactures invitation links, retries writes on its own, or interprets billing plans and seat
counts in the browser.

## Public surface

- `OpenCraneOrganizationMembersGateway` — live implementation bound by the app composition root.

## Boundary

Consumed only by `opencrane-ui` dependency injection. Unexpected or malformed API failures become
an unknown typed error, so the feature cannot infer access or payment policy from untrusted text.

## Dependency direction

Tagged `scope:organization-members` and `frontend-role:adapter`. It may import the member state port
and shared core HTTP client; it must not import a feature, app, or backend implementation.

## See also

- Parent package: [members state](../README.md)
- Group index: [organisation state](../../README.md)
- Consumer app: [opencrane-ui](../../../../../../apps/opencrane-ui/README.md)
