# @opencrane/backend/server/gateways/providers — provider keys + model registry

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › providers

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external models agents may use. It owns the **provider keys** and the **model registry**. A
*provider* is an upstream model vendor (OpenAI, Anthropic, and so on). OpenCrane supports **BYOK**
(bring your own key): a customer supplies their own upstream API key, and OpenCrane wires it into
its model proxy without exposing the raw key afterwards.

It is the entry point that turns a supplied key into usable models. When an authorised administrator sets a BYOK
key, this package first commits an authorisation-bound command. A post-commit executor then stores
the key as a Kubernetes Secret, registers it with LiteLLM (the model proxy), records a credential
row, and seeds the provider's default models. It also owns the model registry —
the definitions the routing layer later resolves against. A model definition may explicitly admit
PNG image generation; that allowlist is frozen into each compiled run before the runtime can enable
the provider-native image tool.

```
 authorised administrator sets a raw provider key   (OpenAI · Anthropic · …)
        │
        ▼
 ┌────────────────────────────────────┐
 │  providers  ◄── HERE                │  commit command → release transaction;
 │                                     │  store key → Secret + LiteLLM; finalize command
 └────────────────────────────────────┘
        │  registered models + credential status  (the key itself is never echoed back)
        ▼
 model-routing resolves which model each request uses
```

**In this flow:** [model-routing](../../model-routing/main/README.md) *(owns external LiteLLM adapters and resolves models)* · providers *(owns durable command and final product projections)* · LiteLLM *(the proxy the key is registered into)*

Invariant: the raw key is write-only from the API's point of view — reads return presence and
timestamps (`configured`, `litellmRegistered`, `updatedAt`), never the key. A command stores a
random-command-salted verifier, not the key. A crash before Secret custody leaves the command in
`AwaitingMaterial`; the administrator resubmits the same key and returned `commandId` to the same
PUT route. A model registration is resumed through
`POST /api/v1/models/:id/registration-commands/:commandId`, so it never creates a second unique
definition. Non-secret `Pending` commands and expired claims are also consumed by the bounded
control-plane reconciliation loop; a process crash does not require the original HTTP request to
remain alive. `DELETE /api/v1/providers/byok/:provider?commandId=…` may explicitly retry the exact
removal returned by a pending response.

| State | Event | Result |
|---|---|---|
| `Pending` | valid claim | `Claimed` with a leased fence |
| `Pending` | provider key missing or different | `AwaitingMaterial` |
| `AwaitingMaterial` | matching key resubmitted | `Claimed` |
| `Claimed` | effect and finalization succeed | `Succeeded` (terminal) |
| `Claimed` | fixed-name upstream request ends without a response | retains the same claim and resource barrier until the exact command is retried |
| `Claimed` | external effect succeeds but current authorization or lifecycle blocks finalization | saves secret-free evidence and retains the claim; recovery finalizes that evidence without repeating external I/O |
| `Claimed` | effect fails before attempt three | `Pending` or `AwaitingMaterial` |
| `Claimed` | third effect attempt fails | `Failed` (terminal) |
| `Succeeded` / `Failed` | any delivery request | no external call |

Authorization has one path. Credential and model catalogues load lifecycle-eligible rows and then
filter exact `ProviderConnection/Read` or `ModelDefinition/Read` resources through the central
`AuthorizationAuthority`. Credential, BYOK, and model-definition mutations explicitly request
`Organization/<silo>/Administer`. Database mutations and provider-effect admissions commit decision
evidence, protected intent, and the command through the same Serializable transaction. Kubernetes
and LiteLLM run only after that transaction commits. Every governed resource has a monotonic desired
generation: admitting a newer Set, Delete, or Register command supersedes older inactive work. A
claimed command is the external resource's serialization barrier, even after its lease expires, so
a conflicting admission returns `409 PROVIDER_EFFECT_BUSY` with that existing command id instead of
creating a newer generation. Only that exact command may be reclaimed after expiry. Model update and
delete use the same barrier while registration is Pending, AwaitingMaterial, or Claimed. The executor
does not spend the terminal delivery budget or release the barrier when LiteLLM may still complete a
timed-out fixed-name mutation; the route `commandId` resume must positively converge that same desired
state before another Set or Delete is admitted. The executor
re-admits the saved subject through the current central authority during claim, immediately before
external I/O, and during finalization. It also rechecks the current model lifecycle and desired
generation. A revocation or lifecycle change after external I/O leaves the exact claim and resource
barrier intact; it never reports success or releases potentially late upstream work. The
background reconciler receives its fixed system executor profile from application composition; it
never trusts a profile stored on a command as its own identity. There is no session-role or
tenant-scope policy engine beside it.

Creating a provider connection or model definition also writes exact `Discover`, `Read`, and `Use`
grants for its creator in that transaction. Organisation administration permits creation; it does
not become an implicit grant to use every provider or model.

## Public surface

- `providerByokRouter`, `providerCredentialsRouter`, `modelRegistryRouter` —
  the routers, mounted at `/api/v1/providers/*` and `/api/v1/models`.
- `_ProvidersOpenapiPaths` — the OpenAPI (REST API description) path fragments for this surface.
- `_CreateProviderEffectCommandExecutor` — the shared route and background-reconciler composition.

The application root constructs that executor once and injects the same instance into both routers
and the background reconciler. Routes cannot construct a local executor or silently omit durable
reconciliation. The external handler has no Prisma client: it returns a secret-free credential and
model projection, and `PrismaProviderEffectCommandRepository.complete` persists that projection only
inside the final current-authority and claim-fence transaction. The command's `result` retains the
same secret-free external evidence, including the exact confirmed embedding deployment identifiers,
so recovery can distinguish a qualified target from an assumed one.

## Boundary

The application layer mounts the routers and supplies a `PrismaClient`, the Kubernetes core API
client, and the operator namespace. This package does not resolve which model a request uses
(that is `model-routing`) and does not run model calls (that is LiteLLM). It fails closed: an
invalid key or unknown provider is rejected before anything is stored.

## Dependency direction

Tagged `scope:providers`: it may depend only on `scope:auth`, `scope:cluster-tenants`,
`scope:authorization`, `scope:model-routing`, `scope:providers`, and `scope:shared` — never on apps or other server
domains.

## Data & persistence

Owns `ProviderCredential`, `ModelDefinition`, and `ProviderEffectCommand` in
`apps/opencrane/prisma/schema/providers.prisma`.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [model-routing](../../model-routing/main/README.md) · [mcp](../../mcp/main/README.md)
