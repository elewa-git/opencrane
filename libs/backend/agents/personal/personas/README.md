# Personal personas

> [backend](../../../README.md) › [agents](../../README.md) › [personal](../README.md) › personas

This group owns how a person establishes and changes the saved personality and instructions their
agent runs with. A persona becomes live only through an interview-backed, reviewable approval
process; no editable runtime file can replace that evidence.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Profile provisioning, interview evidence, draft derivation, approval, owner-only HTTP, and aggregate persistence seams. |

```
 reviewed questions ─► interview answers ─► draft evidence
                                             │
                                             ▼
                                ┌──────────────────────────┐
                                │ personas/main ◄── HERE    │  validate · approve · activate
                                └──────────────────────────┘
                                             │
                                             ▼
                                      active persona revision
```

**In this flow:** [configuration](../configuration/README.md) can supply an accepted refresh
proposal, and [execution inputs](../../execution/inputs/main/README.md) later reads the approved
persona into an immutable run snapshot.

The child package is tagged `scope:personal-personas`. It may use shared contracts, its own scope,
the narrow request-principal authentication seam, and the configuration-owned refresh repository.
It does not import an app, make a configuration decision, or expose its Prisma repositories as a
general data-access API.

## See also

- Parent group: [personal-agent domains](../README.md)
- Related changes: [configuration](../configuration/README.md)
- Resulting input: [execution inputs](../../execution/inputs/main/README.md)
