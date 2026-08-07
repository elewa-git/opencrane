# @opencrane/backend/server/gateways/providers — provider keys + model registry

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › providers

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external models agents may use. It owns the **provider keys** and the **model registry**. A
*provider* is an upstream model vendor (OpenAI, Anthropic, and so on). OpenCrane supports **BYOK**
(bring your own key): a customer supplies their own upstream API key, and OpenCrane wires it into
its model proxy without exposing the raw key afterwards.

It is the entry point that turns a supplied key into usable models. When an org admin sets a BYOK
key, this package stores it as a Kubernetes Secret, registers it with LiteLLM (the model proxy),
records a credential row, and seeds the provider's default models. It also owns the model registry —
the definitions the routing layer later resolves against.

```
 org admin sets a raw provider key   (OpenAI · Anthropic · …)
        │
        ▼
 ┌────────────────────────────────────┐
 │  providers  ◄── HERE                │  store key → k8s Secret + LiteLLM credential;
 │                                     │  register the provider's models; record credential row
 └────────────────────────────────────┘
        │  registered models + credential status  (the key itself is never echoed back)
        ▼
 model-routing resolves which model each request uses
```

**In this flow:** [model-routing](../../model-routing/main/README.md) *(owns the provisioning helpers + resolves models)* · LiteLLM *(the proxy the key is registered into)*

Invariant: the raw key is write-only from the API's point of view — reads return presence and
timestamps (`configured`, `litellmRegistered`, `updatedAt`), never the key. The actual provisioning
work (Secret write + LiteLLM `/credentials` + credential row + default-model seed) lives in
`model-routing`'s `_ProvisionByokKey`, so the boot-time bootstrap can reuse the exact same path;
this domain is the HTTP wrapper plus the reference-only credential variant that rejects raw keys.
Model registration is best-effort against LiteLLM: a rejected model fails to route until corrected
but never corrupts the stored key.

## Public surface

- `providerByokRouter`, `providerCredentialsRouter`, `modelRegistryRouter` —
  the routers, mounted at `/api/v1/providers/*` and `/api/v1/models`.
- `_ProvidersOpenapiPaths` — the OpenAPI (REST API description) path fragments for this surface.

## Boundary

The application layer mounts the routers and supplies a `PrismaClient`, the Kubernetes core API
client, and the operator namespace. This package does not resolve which model a request uses
(that is `model-routing`) and does not run model calls (that is LiteLLM). It fails closed: an
invalid key or unknown provider is rejected before anything is stored.

## Dependency direction

Tagged `scope:providers`: it may depend only on `scope:auth`, `scope:cluster-tenants`,
`scope:model-routing`, `scope:providers`, and `scope:shared` — never on apps or other server
domains.

## Data & persistence

Owns `ProviderCredential` and `ModelDefinition` in
`apps/opencrane/prisma/schema/providers.prisma`.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [model-routing](../../model-routing/main/README.md) · [mcp](../../mcp/main/README.md) · [integrations](../../integrations/main/README.md)
