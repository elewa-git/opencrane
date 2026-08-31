# Bind a warm runtime

> [agent-runtime](../../README.md) › bootstrap

This package generates fresh public proof-key evidence and binds a reviewed warm Pod to its saved
database reservation. The server returns the attempt model key only after that binding is saved. A
permanent refusal ends the process before any command stream is opened.

The public JWK and thumbprint are saved in the Pod's temporary `emptyDir` before the first request.
A container restart on the same Pod reuses them for an exact binding replay. The file never contains
a private proof key or model key and disappears when the workflow deletes the Pod.

```text
projected Pod identity
        │
        ▼
┌──────────────────────┐
│ bootstrap  ◄── HERE  │  create proof key and bind its public half once
└──────────┬───────────┘
           ▼ model key stays in memory
authenticated command stream
```

| File | Responsibility |
| --- | --- |
| `proof.py` | Generates the proof key and its deterministic public thumbprint. |
| `exchange.py` | Performs the fail-closed, one-use control-plane exchange. |

It depends only on app configuration and observability. It cannot select a run, accept caller-supplied
run coordinates, or retry a permanent binding refusal.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Model execution: [model loop](../model_loop/README.md)
- Network boundary: [transport](../transport/README.md)
