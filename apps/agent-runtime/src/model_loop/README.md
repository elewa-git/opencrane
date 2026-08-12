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
| `openai_generated_outputs.py` | Keeps final provider file coordinates private, retrieves bytes once, and classifies them locally. |
| `checkpoints.py` | Replaces encrypted checkpoints and validates their server coordinates. |

The loop cannot execute tools or make its local checkpoint authoritative. It hands every neutral
event to the protocol step. Completed Pydantic `FilePart` values become neutral generated-output
events only after the whole response stays within ten files, 200 MiB total, and the approved media
types. The immutable compiled route alone enables pinned PNG image generation or code execution.
Code-execution container files are downloaded through the official zero-retry OpenAI client before
publication; only magic-verified neutral bytes cross the adapter. Partial events, provider IDs,
annotations, headers, response bodies, and credentials never cross this boundary.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Proof binding: [bootstrap](../bootstrap/README.md)
- Candidate projection: [protocol](../protocol/README.md)
