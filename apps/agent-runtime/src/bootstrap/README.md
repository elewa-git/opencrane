# Bind runtime identity

> [agent-runtime](../../README.md) › bootstrap

This package generates fresh public proof-key binding evidence and binds it through the one-use
control-plane bootstrap. A permanent refusal ends the process before any command stream is opened.

```text
projected Pod identity
        │
        ▼
┌──────────────────────┐
│ bootstrap  ◄── HERE  │  create proof key and bind its public half once
└──────────┬───────────┘
           ▼
authenticated command stream
```

| File | Responsibility |
| --- | --- |
| `proof.py` | Generates the proof key and its deterministic public thumbprint. |
| `exchange.py` | Performs the fail-closed, one-use control-plane exchange. |

It depends only on app configuration, observability, and the outbound HTTP transport. It cannot
select a run or retry a permanent bootstrap refusal.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Model execution: [model loop](../model_loop/README.md)
- Network boundary: [transport](../transport/README.md)
