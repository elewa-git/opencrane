# API overview

The OpenCrane control plane exposes a versioned HTTP API at `/api/v1`.

::: tip Looking for the endpoint list?
This page covers authentication, error envelopes, and pagination conventions. For
the full, browsable endpoint and schema reference, see the
[interactive API reference](/reference/api).
:::

A machine-readable OpenAPI 3.1 description is emitted from the build and served at runtime:

```
GET /api/v1/openapi.json
```

Use the OpenAPI document as the authoritative contract. This reference provides a human-readable overview and authentication guide.

---

## Authentication

All endpoints (except the auth and OpenAPI routes listed below) require a bearer token.

**Header format:**
```
Authorization: Bearer <token>
```

**Current paths:**
- **Bearer token** — send `Authorization: Bearer <token>` from automation or a generated client. This is the automation and break-glass path.
- **OIDC** — human operators authenticate via `GET /api/v1/auth/login` → callback → session cookie. See the [Auth](#auth) section below.

Projected ServiceAccount tokens are the current in-cluster authentication mechanism for pod-to-opencrane-api calls. Each tenant pod presents an audience-bound projected token that is validated via the Kubernetes TokenReview API (`/api/internal/contract`, `/api/internal/awareness/participation`). Static bearer tokens remain the automation and break-glass path for operators outside the cluster.

---

## Base URL

All API routes are prefixed with `/api/v1`. Infrastructure routes (`/healthz`, `/prom`) are unprefixed.

---

## Endpoints

### Tenants

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tenants` | List all tenants |
| `POST` | `/tenants` | Create a tenant |
| `GET` | `/tenants/{name}` | Get a tenant by name |
| `PUT` | `/tenants/{name}` | Update a tenant |
| `DELETE` | `/tenants/{name}` | Delete a tenant |
| `POST` | `/tenants/{name}/suspend` | Suspend a tenant pod |
| `POST` | `/tenants/{name}/resume` | Resume a suspended tenant |
| `GET` | `/tenants/{name}/datasets` | Get tenant dataset memberships |
| `PUT` | `/tenants/{name}/datasets` | Update tenant dataset memberships |
| `GET` | `/tenants/{name}/effective-contract` | Get the compiled runtime contract for a tenant |
| `GET` | `/tenants/drift` | Report projection drift between CRDs and PostgreSQL |
| `POST` | `/tenants/repair` | Repair drifted tenant projections (dry-run by default; append `?dryRun=false` to apply) |

### Access Policies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policies` | List all access policies |
| `POST` | `/policies` | Create a policy |
| `GET` | `/policies/{name}` | Get a policy by name |
| `PUT` | `/policies/{name}` | Update a policy |
| `DELETE` | `/policies/{name}` | Delete a policy |
| `GET` | `/policies/drift` | Report drift for policy projections |
| `POST` | `/policies/repair` | Repair drifted policy projections |

### MCP Servers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mcp-servers` | List MCP server registrations |
| `POST` | `/mcp-servers` | Register an MCP server |
| `GET` | `/mcp-servers/{id}` | Get an MCP server |
| `PUT` | `/mcp-servers/{id}` | Update an MCP server |
| `DELETE` | `/mcp-servers/{id}` | Delete an MCP server |

### Groups

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/groups` | List groups |
| `POST` | `/groups` | Create a group |
| `GET` | `/groups/{id}` | Get a group |
| `PUT` | `/groups/{id}` | Update a group |
| `DELETE` | `/groups/{id}` | Delete a group |

### Skills Catalogue

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills/catalog` | List skill bundles |
| `POST` | `/skills/catalog` | Publish a skill bundle |
| `GET` | `/skills/catalog/{id}` | Get a skill bundle |
| `PUT` | `/skills/catalog/{id}` | Update a skill bundle |
| `DELETE` | `/skills/catalog/{id}` | Remove a skill bundle |

### Third-Party Sources

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/third-party-sources` | List registered third-party sources |
| `POST` | `/third-party-sources` | Register a third-party source |
| `GET` | `/third-party-sources/{id}` | Get a source |
| `PUT` | `/third-party-sources/{id}` | Update a source |
| `DELETE` | `/third-party-sources/{id}` | Remove a source |

### Access Tokens

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/access-tokens` | List access tokens |
| `POST` | `/access-tokens` | Create an access token |
| `DELETE` | `/access-tokens/{id}` | Revoke an access token |

### Provider Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/providers/keys` | List configured provider API keys |
| `PUT` | `/providers/keys` | Set a provider API key |
| `DELETE` | `/providers/keys/{provider}` | Remove a provider key |

### BYOK provider keys

Org-admin–gated raw upstream provider key management. The key is stored in a Kubernetes Secret and registered with LiteLLM; the raw value is never returned by read endpoints.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/providers/byok` | List BYOK provider status (presence + timestamps; no key material) |
| `PUT` | `/providers/byok/{provider}` | Set or refresh a raw provider key (org-admin only) |
| `DELETE` | `/providers/byok/{provider}` | Remove a provider key (org-admin only) |

### Provider credentials

Named references to External-Secrets-synced k8s Secrets. Use these to bind a model definition to a specific key without embedding raw credentials.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/providers/credentials` | List provider credentials |
| `GET` | `/providers/credentials/{id}` | Get a provider credential |
| `POST` | `/providers/credentials` | Register a provider credential |
| `PUT` | `/providers/credentials/{id}` | Update a provider credential |
| `DELETE` | `/providers/credentials/{id}` | Remove a provider credential |

### Model registry

Routable model definitions registered with LiteLLM (BYOM path).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/models` | List model definitions (optional `?clusterTenant=` filter) |
| `GET` | `/models/{id}` | Get a model definition |
| `POST` | `/models` | Register a model definition |
| `PUT` | `/models/{id}` | Update a model definition |
| `DELETE` | `/models/{id}` | Delete a model definition |

### Skill model posture

Per-skill model routing posture (pinned vs. auto selection).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills/posture` | List all skill postures |
| `GET` | `/skills/posture/skill` | Get a skill's posture by compound key (`?name=&scope=&team=`) |
| `PUT` | `/skills/posture/skill` | Set a skill's posture |

### Model routing

Shadow-savings measurement pipeline: eval cases, measurements, proposals, recommendations, and metrics.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/model-routing/eval-cases` | List routing eval cases |
| `GET` | `/model-routing/eval-cases/{id}` | Get an eval case |
| `POST` | `/model-routing/eval-cases` | Create an eval case |
| `PUT` | `/model-routing/eval-cases/{id}` | Update an eval case |
| `DELETE` | `/model-routing/eval-cases/{id}` | Delete an eval case |
| `GET` | `/model-routing/measurements` | List shadow-savings measurements |
| `GET` | `/model-routing/measurements/{id}` | Get a measurement |
| `POST` | `/model-routing/measurements/run` | Trigger a shadow-savings measurement |
| `GET` | `/model-routing/proposals` | List routing-change proposals |
| `GET` | `/model-routing/proposals/{id}` | Get a proposal |
| `POST` | `/model-routing/proposals/{id}/approve` | Approve a proposal |
| `POST` | `/model-routing/proposals/{id}/reject` | Reject a proposal |
| `GET` | `/model-routing/recommendations` | List ranked savings recommendations |
| `GET` | `/model-routing/metrics` | Fetch Langfuse routing metrics (loosely typed) |
| `GET` | `/model-routing/defaults` | Get default model routing settings |
| `PUT` | `/model-routing/defaults` | Update default model routing settings |

:::: details How the effective model is resolved
At call time the control plane walks this precedence and writes the winner into the
tenant's effective contract — no pod restart:

```
explicit request override
  → skill-pinned model
    → skill auto-config
      → ClusterTenant default
        → Global default
```

Each tenant's LiteLLM virtual key carries a `models[]` allowlist, populated from the
registry at key-mint time and kept in sync by the operator's reconcile loop. A call to
a model outside the allowlist is rejected at the gateway.

**How measurement estimates savings.** A run replays every eval case through both the
baseline and the candidate model, grades each output with an independent judge model,
reads the real per-call USD cost from LiteLLM, and estimates the saving with a
bootstrap 95% confidence interval. A proposal is emitted only when that interval
excludes zero.

The measurement seams are **live** — they require a deployed LiteLLM, provider keys,
and a `ROUTING_JUDGE_MODEL`. With any unset, a run is a safe no-op. Full operator
recipe: [`docs/operators/routing-measurement.md`](https://github.com/italanta/opencrane/blob/main/docs/operators/routing-measurement.md).

::: warning Trust the judge, but verify it
Keep the judge model independent of the candidate's family — a model graded by a
sibling of itself scores too highly. LLM-as-judge grading also carries position and
verbosity bias, so calibrate against a small human-graded slice before trusting the
absolute savings figure.
:::
::::

### Sharing

Inter-user entitlement sharing (MCP servers, skill bundles) and direct resource sharing (files, chats, datasets).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/shares` | List shares created by the caller |
| `POST` | `/shares` | Grant an entitlement you hold to another user or group |
| `DELETE` | `/shares/{id}` | Revoke a share you created |
| `GET` | `/resource-shares` | List file/chat resource shares the caller is a member of |
| `POST` | `/resource-shares` | Share a file, chat, or dataset with a user |
| `DELETE` | `/resource-shares/{groupId}/recipients/{subject}` | Revoke a recipient from a resource share |

### Awareness

Contract rollout canary control and fleet participation monitoring.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/awareness/rollout` | Show rollout state |
| `PUT` | `/awareness/rollout` | Set the rollout target version |
| `POST` | `/awareness/rollout/promote` | Advance the promotion frontier |
| `POST` | `/awareness/rollout/rollback` | Roll all waves back to stable |
| `GET` | `/awareness/rollout/resolve/{tenant}` | Resolve the contract version for a tenant |
| `GET` | `/awareness/participation` | Fleet participation health (optional `?severity=critical\|warning`) |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List active assistant sessions |

### Spend

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/spend` | Query spend records |

### AI Budget

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ai-budget/global` | Get global budget settings |
| `PUT` | `/ai-budget/global` | Update global budget settings |
| `GET` | `/ai-budget/accounts` | List per-user account budgets |
| `PUT` | `/ai-budget/accounts/{userId}` | Set a user account budget |
| `DELETE` | `/ai-budget/accounts/{userId}` | Remove a user account budget |
| `GET` | `/ai-budget/{tenantName}/spend` | Get current spend for a tenant |
| `GET` | `/ai-budget/{tenantName}/litellm-key` | Get a tenant's LiteLLM virtual key |
| `POST` | `/ai-budget/{tenantName}/litellm-key/revoke` | Revoke a tenant's LiteLLM virtual key |

### Audit

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit` | Query audit log entries with optional tenant filter and cursor pagination |

**Query parameters:** `tenant`, `limit` (default 100), `cursor`.

Responses include `{ data, pagination: { limit, hasMore, nextCursor? } }`.

### Token Usage

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/token-usage` | Query token usage records |

### Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/metrics/server` | Server health and aggregate platform metrics |
| `GET` | `/metrics/projection-drift` | Tenant and AccessPolicy CRD-to-PostgreSQL drift counts, lag, and alert state |

Prometheus-format metrics are also available at `/prom` (unprefixed).

### Auth

These endpoints do not require a bearer token.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/login` | Initiate OIDC login; redirects to the identity provider |
| `GET` | `/auth/callback` | OIDC callback; establishes a session |
| `POST` | `/auth/logout` | End the current session |
| `GET` | `/auth/me` | Return the current session principal |

---

## Error Envelopes

All `4xx` and `5xx` responses return a consistent envelope:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common codes: `TENANT_NOT_FOUND`, `POLICY_NOT_FOUND`, `VALIDATION_ERROR`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`, `DATASET_DENIED`, `UNAUTHORIZED`.

---

## Pagination

Endpoints that return collections use cursor-based keyset pagination:

```json
{
  "data": [ ... ],
  "pagination": {
    "limit": 100,
    "hasMore": true,
    "nextCursor": "eyJ..."
  }
}
```

Pass `?cursor=<nextCursor>` to fetch the next page.

---

## Infrastructure Routes

These are served without the `/api/v1` prefix and require no auth:

| Route | Description |
|-------|-------------|
| `GET /healthz` | Liveness probe |
| `GET /prom` | Prometheus metrics |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 spec |
