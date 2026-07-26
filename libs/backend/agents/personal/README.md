# Personal-agent domains

> [backend](../../README.md) › [agents](../README.md) › personal

| Package | What it owns |
| --- | --- |
| [conversations](./conversations/main/README.md) | Canonical conversation event history. |
| [configuration](./configuration/main/README.md) | Provenance for changes that apply only to a future run snapshot. |
| [memory](./memory/main/README.md) | Personal memory facts and consent. |
| [personas](./personas/main/README.md) | Interview-backed, approved persona revisions. |

```
 conversation request ─► configuration change ─► next frozen run input
                         (never changes a run already executing)
```

Personal domains describe one person's agent product state. They may use shared contracts but do
not import server control-plane domains or a deployable app.

## See also

- Parent index: [agents](../README.md)
- Shared execution: [execution](../execution/README.md)
