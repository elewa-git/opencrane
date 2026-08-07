# @opencrane/state/provider-key/adapter — live BYOK provider-key gateway

> [frontend](../../../README.md) › [state](../../README.md) › provider-key › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend).
BYOK means **bring-your-own-key**: a customer supplies their own upstream model-provider API key
(OpenAI, Anthropic, and so on) rather than using a platform key. This package owns the frontend seam
for managing those keys: the **`ProviderKeyGateway`** port (a TypeScript interface the settings UI
injects, so it never knows about HTTP) and the live **adapter** that fulfils it.

The adapter, `OpenCraneProviderKeyGateway`, issues typed `GET`/`PUT`/`DELETE` against `/providers/byok`
through the shared Control Plane API client and maps each response onto the `ProviderKeyStatus` read
model. It lists status for every supported provider (even unconfigured ones, seeded from a closed
enum), sets/refreshes a key, and deletes one.

```
 features/tools (BYOK screen)
        │ injects PROVIDER_KEY_GATEWAY (the port)
        ▼
 OpenCraneProviderKeyGateway  ◄── HERE
        │ HTTP: GET/PUT/DELETE /providers/byok[/{provider}]
        ▼
 OpenCrane Control Plane API  ──►  writes a Kubernetes (k8s) secret + LiteLLM (the model-router) credential
```

**In this flow:** [gateways](../../gateways/README.md) · [features/tools](../../../features/tools/README.md)

Invariant: **key material is write-only.** `setKey` is the only path a raw key enters; `list` and every
other read return only status flags (`configured`, `litellmRegistered`, `updatedAt`) — the key value is
never returned to the browser. Error messages are sanitised so server internals never leak to the UI.

## Public surface

- `ProviderKeyGateway`, `PROVIDER_KEY_GATEWAY` — the BYOK port + DI token.
- `ProviderKeyStatus`, `ModelProvider`, `SUPPORTED_MODEL_PROVIDERS` — the read model + the closed provider enum/list.
- `OpenCraneProviderKeyGateway` — the live implementation over `/providers/byok`, bound in `state/gateways`.

## Boundary

Bound to `PROVIDER_KEY_GATEWAY` by [`state/gateways`](../../gateways/README.md) and consumed only
through that port by `features/tools`. It maps the wire shape to the read model; it holds no state
between calls and enforces no authorisation (the control plane does).

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here `@opencrane/core` and Angular — never on apps or server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [mcp/adapter](../../mcp/adapter/README.md) · [settings/adapter](../../settings/adapter/README.md) · [gateways](../../gateways/README.md)
