# @opencrane/state/governance/adapter — signed-in reporting reads

> [frontend](../../../README.md) › [state](../../README.md) › [governance](../README.md) › adapter

## What it owns

The adapter implements the governance read port with the generated application programming
interface (API) client. It carries the ordinary browser session to the existing audit, token-usage
and budget endpoints and validates each successful body before returning it.

```
 governance read port
         ▲ validated rows or safe failure
         │
 governance adapter ◄── HERE ──GET──► shared client ──► protected API
```

**In this flow:** the [port](../README.md) owns types and validators; the [shared client](../../../core/README.md)
owns origin, session cookies and sign-in redirects; server [audit](../../../../backend/server/iam/audit/main/README.md)
and [spend](../../../../backend/server/reporting/spend/main/README.md) packages decide access.

HTTP 401 and 403 are recognised by status even when session middleware returns an untyped body.
Server prose and transport errors are never retained. Aborting before or during a read prevents a
successful late result, including when the transport ignores cancellation.

## Public surface

- `OpenCraneGovernanceReadGateway` — concrete read adapter bound by the browser app.

## Boundary

Issues only GET requests to `/api/v1/audit`, `/api/v1/token-usage`, `/api/v1/ai-budget/global` and
`/api/v1/ai-budget/accounts`. It adds no permission, budget mutation, sampler or role inference.
An authorized empty list is not an access denial; a missing reporting period is not a monthly total.
Screens still invalidate their pending reads on identity changes and access loss.

## Dependency direction

Tagged `scope:governance`, `frontend-role:adapter`, `layer:frontend` and `type:lib`. It consumes its
state port and shared client, never feature, app or backend implementations.

## See also

- Parent and read contract: [governance state](../README.md)
- Shared transport: [frontend core](../../../core/README.md)
- Consumer: [governance screens](../../../features/governance/README.md)
