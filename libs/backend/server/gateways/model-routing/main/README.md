# @opencrane/backend/server/gateways/model-routing — model routing and text requests

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › model-routing

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external models agents may use. Model calls do not go straight to a provider; they go through
**LiteLLM**, a self-hosted proxy that presents many providers behind one interface. This package
decides *which* model each request should use and keeps LiteLLM's catalogue in step.

It sits between the provider gateway (which registers a tenant's models into LiteLLM) and the server
conversation owner (which admits and sends model requests). Its core job is resolving the *effective* model for a request:
a skill may pin a model, or ask for `auto`, or defer — and the default is resolved by scope, with a
ClusterTenant (one customer's tenancy) default taking precedence over the organisation-wide Global
default in the same silo. No provider or model-routing Global row crosses a silo boundary.
It also holds per-tenant model allowlists, the maths for evaluating candidate routing policies,
and the transport for a server-admitted text request. The conversation owner reserves that request
before dispatch and saves its answer; this package sends it once without retrying an uncertain
paid operation.

```
 provider BYOK (bring-your-own-key) key set   →   models registered in LiteLLM
        │
        ▼
 ┌────────────────────────────────────┐
 │  model-routing  ◄── HERE            │  resolve effective model (skill pin → auto → scope default:
 │                                     │  ClusterTenant then Global) · per-tenant allowlist
 │                                     │  · shadow-router maths (off-policy eval, savings)
 └────────────────────────────────────┘
        │  the model id for this request  (+ routing defaults API)
        ▼
 admitted conversation request calls LiteLLM with the resolved model
```

**In this flow:** [providers](../../providers/main/README.md) *(registers keys + models)* · LiteLLM [(vendored app)](../../../../../../apps/_infra/litellm/README.md)

Invariant: `_ResolveSkillModel` is a *pure* function over already-fetched rows — it performs no I/O
and never calls LiteLLM; an empty ClusterTenant default never shadows a usable Global one, and when
nothing resolves it returns `null` so the pod falls back to its own configured default.
`PrismaDefaultModelDefinitionResolverRepository` applies the same default precedence inside a
caller's transaction, then resolves the selected public name to exactly one tenant-accessible model
definition. Missing, foreign-only, or ambiguous definitions fail closed. The
off-policy-evaluation (OPE) and savings helpers are likewise pure estimators used to decide, in
shadow mode, whether a cheaper candidate model would hold quality before it ever routes live
traffic. The BYOK (bring-your-own-key) model catalogue (`_BYOK_PROVIDER_CATALOG`) is data, tuned as providers ship models.

Model registration reads LiteLLM inventory before creating anything. The pinned 1.81.0 proxy's
`/v2/model/info` route returns an empty catalogue on a fresh installation, allowing its first model
to be registered. Failed requests and malformed inventory remain errors. A durable provider command
supplies a deterministic deployment identifier; the inventory entry must match that identifier plus
the admitted upstream model, API base, credential reference, and mode. An absent match permits
`POST /model/new`; a mismatch or ambiguous public name fails without accepting out-of-band state.
Embedding reconciliation returns a closed `NotApplicable`, `Skipped`, or `Confirmed` outcome.
`Confirmed` carries the public name, upstream model, and exact LiteLLM deployment id for both the
provider embedding slug and `auto-embedding`; provider command finalization validates and stores that
secret-free evidence with the governed provider generation.

Credential rotation never deletes before replacing. It atomically PATCHes the fixed LiteLLM
credential name and uses POST only after PATCH confirms a 404 absence. LiteLLM 1.81.0 returns some
credential errors inside HTTP 200, so the adapter checks the explicit success flag or serialized
error code for updates, creation, and deletion. An unknown or malformed body remains uncertain.
The deployed DB-backed
LiteLLM profile reloads patched credentials into memory on its pinned refresh loop. A missing
response from PATCH or POST remains uncertain, so the durable provider command retains its barrier
until an exact retry converges. Provider and `auto-embedding` deployments likewise use stable UUIDs
derived from their governed Global resource, so a late first POST cannot create a second generation.

## Public surface

- `modelRoutingDefaultsRouter` — the routing-defaults router, mounted at
  `/api/v1/model-routing/defaults`; reads and writes require the exact
  `Organization/<silo>/Administer` capability through the transaction-bound central authority.
- `_ResolveSkillModel` — resolve a skill's effective model by the locked precedence chain.
- `DefaultModelDefinitionResolutionStatuses` and
  `PrismaDefaultModelDefinitionResolverRepository` — the closed result vocabulary and Postgres
  adapter that turn the configured effective default into one stable, tenant-accessible
  `ModelDefinition` identifier.
- `_byokSecretName`, `_byokCredentialName`, `_ApplyProviderKeySecret`,
  `_ClearProviderKeySecret`, `_RegisterLiteLlmModel`,
  `_UpsertLiteLlmCredential`, `_DeleteLiteLlmCredential`, and `_EnsureProviderEmbeddingModels` —
  fixed-coordinate custody and LiteLLM adapters used only after a durable provider command commits.
- `_EstimateSavings`, `_ReplayEstimate`, `_DoublyRobustEstimate`, `_OpeEstimateWithCi` — the pure
  shadow-router estimators. `_BYOK_PROVIDER_CATALOG` — the per-provider default model catalogue.
- `_IssueAttemptLiteLlmKey` — mint one short-lived, alias- and budget-bound LiteLLM virtual key for a
  single agent-run attempt (fails hard; the master key never leaves the control plane), with its
  request/result shapes `AttemptLiteLlmKeyRequest` and `AttemptLiteLlmKey`. Issuance requires an
  absolute `notAfter` bound, leaves ten seconds for the mint request and checks the provider's
  returned expiry before handoff. Missing, expired or excessive expiry triggers alias cleanup.
  The key has a one-time budget and never resets its spending allowance within the attempt.
- `_RevokeAttemptLiteLlmKeyByAlias` — reconcile an uncertain mint from its durable attempt alias when
  encrypted custody could not retain the raw key.
- `__RequestConversationModel` — send one chat-completions exchange using the shared
  `ConversationModelRequest` and return a `ConversationModelResponse`. Server composition supplies
  the endpoint, attempt key and model alias; the alias must match `CompiledRunInput`. Completion
  tokens are capped by the smallest reservation, frozen route and frozen run ceiling; at least
  one frozen completion ceiling must exist. The request aborts by the earliest supplied deadline,
  compiled run deadline or 25 seconds, including time spent reading the body.

The first request can offer the frozen tools that need no approval. Names must be unique and legal,
with parameters matching their saved schema digests. The model may return text or propose exactly
one offered tool. The shared declaration retains the provider call id, original argument string
and accompanying text. Arguments must contain a bounded JSON object; the conversation and IAM
owners still validate the actual schema and current permission before any execution.

A continuation supplies that saved declaration and its authorized result. The adapter appends an
assistant tool-call message and a tool-result message with the same provider call id after the
unchanged compiled history. It sends no tool definitions on this request and accepts only text,
so it cannot start a third model/tool cycle. Combined declaration and result content must fit
65,536 serialized UTF-8 bytes, with valid Unicode. These shared schemas are exported by contracts.

The adapter accepts HTTP(S) origins without paths, credentials, queries or fragments and sends
one `POST /v1/chat/completions` with redirects disabled. Serialized request and response bodies are
limited to 1 MiB each; a completed answer is limited to 65,536 UTF-8 bytes. It rejects parallel tool
calls, refusals, partial answers and unsupported output formats. `ConversationModelError` carries
a fixed category without the provider body or original exception. Request fields never enter its
operation span, and automatic child tracing is suppressed around the HTTP call.

This adapter has no durable retry state. Its caller must reserve dispatch before calling, retain
the accepted response before acknowledging it, and treat a lost response as uncertain: a failure
does not prove that the provider did not charge the request. The caller also reserves the total
call and completion budget, keeps one nonrenewed attempt key, admits the proposed action and
rechecks authority before using its result. Adapter tests alone do not qualify the public tool
flow or a live provider.

The pinned LiteLLM v1.81.0-stable implementation creates `expires` from a UTC clock and serializes
it as an ISO timestamp. The adapter checks that evidence instead of storing a locally guessed
expiry. Source: [key management](https://github.com/BerriAI/litellm/blob/v1.81.0-stable/litellm/proxy/management_endpoints/key_management_endpoints.py).
Already issued keys still have a bounded validity window. The transport adapter does not repeat
PostgreSQL admission; the conversation owner must perform that check before reserving dispatch.

## Boundary

The application layer mounts the routers, supplies a `PrismaClient`, and may construct the default
model repository with an already-open transaction. The provider gateway imports the external-effect
adapters. This package sets and resolves routing policy and sends already-admitted model requests.
It does not commit another domain's transaction or persist credentials; LiteLLM and the provider
gateway own provider secrets, and the conversation owner supplies the attempt key in memory.
`ModelRoutingDefault` is organisation policy, not a governed model instance, so the API checks the
organisation capability explicitly instead of inventing a fake `ModelDefinition` resource id. A
write commits its authorization evidence and routing row through the same Serializable database
transaction. Only a P2034 retries that complete transaction, with a fresh authority on each of at
most three attempts.

## Dependency direction

Tagged `scope:model-routing`: it may depend only on `scope:auth`, `scope:authorization`, `scope:cluster-tenants`,
`scope:http`, `scope:model-routing`, and `scope:shared` — never on apps or other server domains.

## Data & persistence

Owns `ModelRoutingDefault` in `apps/opencrane/prisma/schema/model-routing.prisma`. Per-tenant model
rows and provider credentials are owned by the [providers](../../providers/main/README.md) domain.
An `AgentRevision` stores the provider domain's stable `ModelDefinition` identifier, rather than an
unverified alias; this package's catalogue is therefore the allowlist source for executable models.

## Validation

Run `npx nx run backend-server-model-routing:test` and
`npx nx run backend-server-model-routing:lint`. The conversation transport tests use an in-memory fetch
double: they prove limits, cancellation, response validation and absence of retries without making
a paid model request. These checks do not qualify a live provider or the complete conversation flow.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [providers](../../providers/main/README.md) · [mcp](../../mcp/main/README.md)
