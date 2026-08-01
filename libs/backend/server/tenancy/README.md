# Tenancy server capabilities

> [backend](../../README.md) › [server](../README.md) › tenancy

The tenancy group contains the ClusterTenant organisation-scope guard.

| Package | What it owns |
| --- | --- |
| [`cluster-tenants`](./cluster-tenants/main/README.md) | Resolves verified caller membership and enforces the targeted resource's organisation boundary. |

Agent, run, knowledge, gateway, and identity behaviour remains in its owning domain rather than
becoming a generic tenancy capability.

## See also

- Parent index: [server](../README.md)
- Organisation scope package: [cluster-tenants](./cluster-tenants/main/README.md)
