# Execute attempt commands

> [agent-runtime](../../README.md) › attempts

This package executes the control plane's start, resume, and cancel commands against the bounded
model loop. It reports ordered candidates while leaving approval, cancellation, and durable terminal
authority with the server.

```text
start · resume · cancel command
             │
             ▼
┌────────────────────────┐
│ attempt step  ◄── HERE │  coordinate loop, checkpoint, candidates, terminal gate
└────────────┬───────────┘
             ▼
ordered candidate sequence
```

| File | Responsibility |
| --- | --- |
| `execution.py` | Validates commands and coordinates model-loop, checkpoint, and candidate seams. |
| `terminal.py` | Delivers at most one stable terminal candidate per active attempt. |

Cancellation is a positive local signal; the server remains the durable cancellation authority.
Only one start/resume worker is current at a time, and loss of the command stream cancels every
worker that has not yet returned.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Candidate projection: [protocol](../protocol/README.md)
- Command transport: [transport](../transport/README.md)
