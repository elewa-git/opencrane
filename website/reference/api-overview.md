# API overview

The OpenCrane control plane exposes a versioned HTTP API at **`/api/v1`**. Use the
machine-readable OpenAPI document as the authoritative endpoint and schema contract.

::: tip
For contract retrieval and client guidance, see the [API reference](/reference/api).
:::

## OpenAPI document

```text
GET /api/v1/openapi.json
```

The build generates this document from the routers composed by the OpenCrane server. Client
integrations should generate from it instead of copying tables from prose.

## Authentication

Human operators authenticate through the OIDC login and callback flow. The browser then sends
its same-origin session cookie with public API requests.

In-cluster workloads use dedicated internal routes and audience-bound projected ServiceAccount
tokens. Runtime admission adds durable workload assignment, one-use bootstrap and per-attempt
proof checks; network reachability or a valid Kubernetes token alone is insufficient.

## Public resource groups

The current composition includes:

| Prefix | Purpose |
|---|---|
| `/agent-services` | Agent service, revision and run admission |
| `/me/runs` | Current user's run status, steering and cancellation surfaces |
| `/me/conversations` | Authorised conversation replay |
| `/me/approvals` | Deferred action approval decisions |
| `/me/persona` | Personal persona onboarding |
| `/me/assets` | Personal artifact catalogue |
| `/skills` | Skill catalogue and publication |
| `/mcp-servers`, `/mcp` | MCP registration and operator surfaces |
| `/models`, `/model-routing` | Model registry, defaults and metrics |
| `/providers` | Provider credential references and bring-your-own-key configuration |
| `/groups`, `/shares`, `/resource-shares` | Organisation-scoped access and sharing |
| `/audit`, `/ai-budget`, `/token-usage` | Governance evidence and spend controls |

Routes can evolve independently. Always verify the current OpenAPI document before writing a
client.

## Internal trust boundaries

Internal endpoints under `/api/internal` serve fixed workload classes such as the agent
controller, agent runtime, skill workers and artifact preprocessor. They are not an
administrator API and should never be exposed through public Ingress.

## Base URL and health

Public product routes use `/api/v1`. Liveness and metrics routes such as `/healthz` and
`/prom` are unprefixed and should be exposed only according to your operator policy.

## Error handling

Clients should branch on HTTP status and the stable machine-readable error code when present.
Do not infer authorisation state from response text, and do not retry denials as transient
transport failures.

## Generated clients

For TypeScript integrations, use the generated package described in
[Contracts SDK](/integrators/contracts-sdk). It remains aligned with the emitted OpenAPI
contract and shared runtime protocol types.
