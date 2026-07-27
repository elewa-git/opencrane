# State — the gateway-port and adapter layer

> [frontend](../README.md) › state

This is the layer between the browser UI and the backend's HTTP API. A **feature** never talks to
the API directly; it asks a **gateway** — a narrow port (an interface) describing what the UI needs
— and an **adapter** here implements that port against the real HTTP endpoints. Swapping a fake
adapter in for tests, or a live one in production, changes nothing in the feature. The layer also
owns the client-side stores and caches that hold fetched data.

## Map

| Package | What it owns |
| --- | --- |
| [`core`](./core/README.md) | Frontend state-layer hub. |
| [`gateways`](./gateways/README.md) | Gateway dependency-injection composition root. |
| [`conversation/adapter`](./conversation/adapter/README.md) | Canonical conversation replay reader. |
| [`conversation/render`](./conversation/render/README.md) | Vendored render view-models. |
| [`conversation/ag-ui`](./conversation/ag-ui/README.md) | Safe projected-event browser state. |
| [`assets/adapter`](./assets/adapter/README.md) | Live owner-bound personal-asset catalogue gateway. |
| [`mcp/adapter`](./mcp/adapter/README.md) | Live MCP gateway. |
| [`onboarding`](./onboarding/README.md) | Shared onboarding persistence. |
| [`provider-key/adapter`](./provider-key/adapter/README.md) | Live BYOK provider-key gateway. |
| [`settings/adapter`](./settings/adapter/README.md) | Live settings gateway. |
| [`skills/adapter`](./skills/adapter/README.md) | Live governed-skill catalogue gateway. |
| [`utils/storage`](./utils/storage/README.md) | Safe browser-storage seam. |

```
   features
      │ ask a port
      ▼
    core  ── defines ports, holds stores ──  gateways (wires ports → adapters)
      │
      ├─ conversation/{adapter,ag-ui,cache,render}   assets/adapter   skills/adapter
      ├─ mcp/adapter   provider-key/adapter   settings/adapter
      └─ onboarding   utils/storage
      ▼ HTTP
   backend API
```

## Dependency rule for this tier

State packages carry `scope:web`, `layer:frontend`, and `type:lib`. They may import shared contracts and each other
within the state layer (adapters depend on the ports and stores in `core`; `gateways` wires them
together). They must **not** import a [`feature`](../features/README.md) or a backend package —
data flows up to features, dependencies point down to the API. Never import an app.

## See also

- Parent index: [`libs/frontend`](../README.md)
- Sibling groups: [`libs/frontend/features`](../features/README.md) · [`libs/frontend/elements`](../elements/README.md)
