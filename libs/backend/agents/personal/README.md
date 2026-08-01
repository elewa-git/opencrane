# Personal-agent domains

> [backend](../../README.md) › [agents](../README.md) › personal

| Package | What it owns |
| --- | --- |
| [configuration](./configuration/main/README.md) | Provenance for changes that apply only to a future run snapshot. |
| [memory](./memory/main/README.md) | Verified personal dataset and preference-fact selection. |
| [personas](./personas/main/README.md) | Interview-backed, approved persona revisions. |

```
 agent request ─► configuration change ─► next frozen run input
                  (never changes a run already executing)
```

Personal domains describe one person's agent product state. Generic durable fact catalogue metadata
and outbox intent live in [agent memory](../memory/main/README.md), not here. Personal domains may
use shared contracts but do not import server control-plane domains or a deployable app.

## See also

- Parent index: [agents](../README.md)
- Shared execution: [execution](../execution/README.md)
- Generic catalogue: [agent memory](../memory/main/README.md)
