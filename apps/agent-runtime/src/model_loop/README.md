# Run the bounded model loop

> [agent-runtime](../../README.md) › model loop

This package adapts the attempt-scoped Pydantic AI loop into framework-neutral events and stores only
an encrypted, replaceable local checkpoint subordinate to canonical server state.

```text
compiled run input
       │
       ▼
┌──────────────────────┐
│ model loop ◄── HERE  │  request model, absorb safe steering, emit neutral events
└──────────┬───────────┘
           ▼
framework-neutral events
```

| File | Responsibility |
| --- | --- |
| `driver.py` | Owns model construction, zero-retry policy, event translation, and safe steering. |
| `checkpoints.py` | Replaces encrypted checkpoints and validates their server coordinates. |

The loop cannot execute tools or make its local checkpoint authoritative. It hands every neutral
event to the protocol step.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Proof binding: [bootstrap](../bootstrap/README.md)
- Candidate projection: [protocol](../protocol/README.md)
