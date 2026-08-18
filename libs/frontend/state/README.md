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
| [`conversation/stream`](./conversation/stream/README.md) | Transport-neutral browser stream port and connection states. |
| [`conversation/adapter`](./conversation/adapter/README.md) | Signed-in HTTP implementation of the conversation stream port. |
| [`conversation/render`](./conversation/render/README.md) | Vendored render view-models. |
| [`conversation/ag-ui`](./conversation/ag-ui/README.md) | Safe projected-event browser state. |
| [`conversation/elicitation`](./conversation/elicitation/README.md) | Recoverable participant-input gateway, store, and Activity mapping. |
| [`conversation/agent-threads`](./conversation/agent-threads/README.md) | Dependency-neutral Agent-thread gateway, state dimensions, store, and purge rules. |
| [`conversation/workspace`](./conversation/workspace/README.md) | Snapshot-tail conversation workspace and separate run command state. |
| [`conversation/workspace/adapter`](./conversation/workspace/adapter/README.md) | Signed-in generated-client adapter for workspace commands. |
| [`assets/adapter`](./assets/adapter/README.md) | Live owner-bound personal-asset catalogue gateway. |
| [`conversation/assets`](./conversation/assets/README.md) | Component-scoped conversation upload, retry, and safe lifecycle state. |
| [`mcp/adapter`](./mcp/adapter/README.md) | Live MCP gateway. |
| [`onboarding`](./onboarding/README.md) | Server-backed persona onboarding orchestration. |
| [`onboarding/projection`](./onboarding/projection/README.md) | Narrow frontend first-chat projection vocabulary. |
| [`persona`](./persona/README.md) | Personal-persona browser adapters. |
| [`provider-key/adapter`](./provider-key/adapter/README.md) | Live BYOK provider-key gateway. |
| [`organization`](./organization/README.md) | Organisation-level state and adapter map. |
| [`organization/members`](./organization/members/README.md) | Member-directory and invitation gateway port and stores. |
| [`organization/members/adapter`](./organization/members/adapter/README.md) | Live generated-client organisation-member adapter. |
| [`skills/adapter`](./skills/adapter/README.md) | Live governed-skill catalogue gateway. |

```
   features
      │ ask a port
      ▼
    core  ── defines ports, holds stores ──  gateways (wires ports → adapters)
      │
      ├─ conversation/{stream,adapter,ag-ui,render}  assets/adapter   skills/adapter
      ├─ mcp/adapter   provider-key/adapter   organization/members/adapter
      └─ onboarding ── persona/adapter
      ▼ HTTP
   backend API
```

## Dependency rule for this tier

Legacy state packages carry `scope:web`; new capability slices use a bounded `scope:<capability>`.
All state packages use `layer:frontend` and `type:lib`. Onboarding additionally uses explicit state
and adapter role tags so adapters depend inward on ports while state cannot depend back on adapters.
State must **not** import a [`feature`](../features/README.md) or backend package — data flows up to
features, dependencies point down to the API. Never import an app.

## See also

- Parent index: [`libs/frontend`](../README.md)
- Sibling groups: [`libs/frontend/features`](../features/README.md) · [`libs/frontend/elements`](../elements/README.md)
