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
| `event_projector.py` | Owns per-command message lifecycle and tool proposal ordering. |

Tool revisions come only from the compiled grant set. Malformed or ungranted tool calls fail closed
as `tool.failed` events and never become external actions. Text output is projected as one
`message.started` / ordered `message.delta` / `message.completed` lifecycle per command. Provider
errors expose a bounded type but never the provider message. Usage counters and text deltas are
bounded before transport.

The neutral seam also recognizes three explicit A2UI inputs: rendering begun, surface updated, and
data-model updated. It forwards only an adapter-supplied complete envelope. The default Pydantic AI
adapter emits none of these and this package never invents a surface, component, version, or
coordinate shape. Wiring A2UI returned actions back into governed agent execution remains follow-up
work in #351 and #604.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Model events: [model loop](../model_loop/README.md)
- Attempt execution: [attempts](../attempts/README.md)
