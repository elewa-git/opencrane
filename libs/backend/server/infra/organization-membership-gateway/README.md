# @opencrane/backend/server/infra/organization-membership-gateway — Fleet membership transport

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › organization-membership-gateway

## What it owns

This library owns the server's outbound HTTP and credential boundary for Fleet-controlled
organisation membership. It re-reads a rotating, audience-bound projected ServiceAccount token for
every request, refuses non-HTTPS origins and redirects, bounds response bodies, and forwards only
identity selected by the OpenCrane server.

It does not decide roles, invitation state, payment outcomes, or API error semantics. The
`organization-members` IAM package owns those decisions and consumes this transport through its
structural port. Fleet remains the receiver and paid-seat authority; this repository does not ship
the Fleet receiver or a payment-provider integration.

## Public surface

- `FleetOrganizationMembershipHttpClient` sends one authenticated, timeout-bounded exchange.
- `FleetOrganizationMembershipHttpClientConfig` names the HTTPS origin, exact silo, projected-token
  file, and timeout.

## Boundary

The receiver must TokenReview the configured audience, require the expected OpenCrane server
ServiceAccount, and bind that workload identity to the configured silo before trusting forwarded
OIDC subject fields. Network or protocol failures throw; no local membership fallback exists.

## Dependency direction

Tagged `scope:organization-membership-gateway` and `layer:infra`. It depends only on shared
observability and platform primitives, never on a backend domain or application source.

## See also

- Parent index: [infra](../README.md)
- Domain authority: [organization-members](../../iam/organization-members/main/README.md)
