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

**This composition is not wired into production in the current checkout.** The
[conversation package](../../server/conversations/main/README.md) owns the browser-facing entry;
[configuration](./configuration/README.md) records changes for later runs; [personas](./personas/README.md)
makes the personality and instructions reviewable before activation; [personal memory](./memory/README.md)
chooses already-consented coordinates; [execution inputs](../execution/inputs/main/README.md) freezes
the accepted inputs; and [personal memory](./memory/main/README.md) owns the durable dataset and fact
metadata admitted into that snapshot.

The intended browser contract starts a personal conversation run with its existing `conversationId`
and a `requestIdempotencyKey`, while the server derives all authority coordinates. The current
conversation path does not yet call execution inputs, so it does not create that run or snapshot.

Personal memory decides *which* verified dataset and preference facts can enter a run and owns their
content-free catalogue metadata. Durable fact content remains behind the
[memory gateway](../../../server/_infra/memory-gateway-client/README.md). This group never treats a
subject identifier or a browser request as permission to choose a dataset.

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
- Browser-facing entry: [conversations](../../server/conversations/main/README.md)
- Dataset and fact catalogue: [personal memory](./memory/main/README.md)
- Fact-content boundary: [memory gateway](../../../server/_infra/memory-gateway-client/README.md)
