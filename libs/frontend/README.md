# OpenCrane frontend libraries

> [OpenCrane](../../README.md) › frontend

Frontend packages are grouped by Angular responsibility: `elements/` for presentation,
`features/` for routed UI slices, and `state/` for gateway ports, adapters, and client state.
That technical layering is deliberately unchanged by the server's domain regrouping.

## Shared vocabulary map

The table gives readers the closest server-domain vocabulary without creating a second forced
directory hierarchy in the SPA.

| Product vocabulary | Frontend entry points | Server group |
| --- | --- | --- |
| Managed personal agents | `features/onboarding`, `state/onboarding`, `state/persona/adapter` | personal agents and `server/agents` |
| Gateway governance | `features/tools`, `state/mcp/adapter`, `state/provider-key/adapter` | `server/gateways` |
| Governed skill catalogue | `state/skills/adapter` | `server/agents/skills` |
| Personal asset catalogue | `state/assets/adapter` | server-side artifact authority |
| Conversation files | `state/conversation/assets` | participant upload and quarantine authority |
| Conversation file presentation | `features/conversation-assets` | attachment tray, transcript cards, and Files index |
| Shared browser composition | `core`, `platform`, `elements/*`, `state/core`, `state/gateways` | cross-cutting |

`state/gateways` is Angular dependency-injection composition, not the server `gateways` domain.
Keep the names distinct: frontend dependencies follow the technical layer policy; server imports
use explicit public domain barrels.

## See also

- Parent front door: [OpenCrane](../../README.md)
- Child groups: [features](./features/README.md) · [elements](./elements/README.md) ·
  [state](./state/README.md)
