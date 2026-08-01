# Project the runtime protocol

> [agent-runtime](../../README.md) › protocol

This package keeps framework objects behind a neutral seam and binds candidates to immutable command
coordinates without taking over server authority.

```text
neutral model event
       │
       ▼
┌──────────────────────┐
│ protocol   ◄── HERE  │  validate grants, bind coordinates, build candidate
└──────────┬───────────┘
           ▼
stable protocol candidate
```

| File | Responsibility |
| --- | --- |
| `candidates.py` | Validates model events and builds stable event or external-action candidates. |

Tool revisions come only from the compiled grant set. Malformed or ungranted tool calls fail closed
as errors and never become external actions.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Model events: [model loop](../model_loop/README.md)
- Attempt execution: [attempts](../attempts/README.md)
