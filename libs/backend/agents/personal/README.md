# Personal-agent domains

> [backend](../../README.md) › [agents](../README.md) › personal

This group holds the product rules that belong to one person's agent. It separates the choices a
person makes about their agent from the shared machinery that later runs it, so a future managed
agent can reuse the machinery without inheriting personal policy.

| Package | What it owns |
| --- | --- |
| [configuration](./configuration/README.md) | Reviewed proposals, future-session materialisation, and the refresh Unit of Work. |
| [personas](./personas/README.md) | Onboarding, profile, interview, drafting, approval, owner-only Hypertext Transfer Protocol (HTTP), and the small persistence boundaries that keep this lifecycle whole. |
| [memory](./memory/README.md) | Verified dataset and explicit preference selection for one admitted run. |

```
 POST /api/v1/me/conversations/:conversationId/messages  { conversationId · requestIdempotencyKey }
        │ trusted session + host
        ▼
 execution admission ── proves conversation · membership · grants
        │
        ├── configuration ── active revision ─────┐
        ├── personas ─────── approved persona ────┼──► frozen run input
        └── personal memory ─ verified coordinates┘
```

**In this flow:** [execution admission](../execution/admission/main/README.md) owns the trusted entry;
[configuration](./configuration/README.md) records changes for later runs; [personas](./personas/README.md)
makes the personality and instructions reviewable before activation; [personal memory](./memory/README.md)
chooses already-consented coordinates; [execution inputs](../execution/inputs/main/README.md) freezes
the accepted inputs; and [agent memory](../memory/main/README.md) owns durable fact metadata and its
outbox intent.

The browser may start a personal conversation run with only its existing `conversationId` and a
`requestIdempotencyKey` used to make retries return the same run. The server derives the person from
the authenticated session and the silo from the trusted host, then re-resolves the participant-bound
conversation, personal agent service, signed fleet membership, effective grants, approved persona, and
personal-memory coordinates inside the admission flow. None of those authority coordinates can be
supplied in the request body.

The boundary between the two memory packages is deliberate. Personal memory only decides *which*
verified dataset and preference facts can enter a run. It neither stores fact text nor writes a fact
catalogue. The generic [agent-memory authority](../memory/main/README.md) records content-free
catalogue metadata and outbox intent after the [memory gateway](../../../server/_infra/memory-gateway-client/README.md)
has accepted content. This group never treats a subject identifier or a browser request as permission
to choose a dataset.

Each child is a backend domain with a narrow scope tag. It may use shared contracts and its explicitly
allowed capability ports, but not a deployable app or a server control-plane implementation. The one
intentional cross-domain composition is persona refresh: the owner-only persona HTTP composition
constructs configuration's `PrismaPersonalConfigurationPersonaRefreshUnitOfWork` and injects its
narrow transaction bridge into the persona lifecycle. Personas never read or write configuration
records directly. Other cross-domain coordination happens in an owning Unit of Work or above these
domains in the OpenCrane composition root.

## See also

- Parent index: [agents](../README.md)
- Shared execution: [execution](../execution/README.md)
- Trusted entry: [execution admission](../execution/admission/main/README.md)
- Generic catalogue: [agent memory](../memory/main/README.md)
- Fact-content boundary: [memory gateway](../../../server/_infra/memory-gateway-client/README.md)
