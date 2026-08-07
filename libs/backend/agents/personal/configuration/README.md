# Personal configuration

> [backend](../../../README.md) › [agents](../../README.md) › [personal](../README.md) › configuration

This group owns the reviewable changes a person asks their agent to apply on a later session. It
protects the frozen input of a running session: a change may prepare a successor, but it cannot
silently rewrite work already under way.

A Unit of Work is the narrow object that makes a coordinated database change succeed or fail as one
operation. It is used here when an accepted change must also update another authority safely.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Proposal evidence, owner decisions, future-session materialisation, and the persona-refresh Unit of Work. |

```
 runtime proposes a closed change
          │
          ▼
 ┌───────────────────────────────┐
 │ configuration/main ◄── HERE    │  record · review · decide
 └───────────────────────────────┘
          │ accepted change only
          ├──► persona interview and approval
          └──► successor agent revision
```

**In this flow:** [personas](../personas/README.md) applies an accepted persona refresh, and
[execution inputs](../../execution/inputs/main/README.md) later freezes the resulting approved
state into a run.

The child package is tagged `scope:personal-configuration`. It may use its own scope, shared
contracts, the request-principal authentication seam, and the narrow agent-service materialisation
port. It must not import an app or use another personal domain's persistence adapter directly.

## See also

- Parent group: [personal-agent domains](../README.md)
- Related lifecycle: [personas](../personas/README.md)
- Resulting input: [execution inputs](../../execution/inputs/main/README.md)
