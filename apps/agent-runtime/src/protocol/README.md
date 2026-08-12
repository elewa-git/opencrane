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
| `elicitation.py` | Validates bounded neutral participant-input events and computes protected-payload digests. |

Tool revisions come only from the compiled grant set. Malformed or ungranted tool calls fail closed
as `tool.failed` events and never become external actions. Text output is projected as one
`message.started` / ordered `message.delta` / `message.completed` lifecycle per command. Provider
errors expose a bounded type but never the provider message. Usage counters and text deltas are
bounded before transport.

The explicit `elicitation_request` neutral event can propose only `runtime_input` or `a2ui_action`.
It is produced by the always-present execution-free `opencrane_request_input` model tool; it is not
dependent on any user-configured external tool grant.
Body text, identifiers, choices, selection limits, expiry duration, and optional disclosure fields
use the same bounds as the TypeScript transport validator. Ordinary input cannot carry a hidden
payload. A2UI input must carry exactly `displayedActionId`, `sourceComponentId`, and `actionDigest`;
the runtime computes the canonical payload digest and never accepts one from model output. One
question is accepted per command. The adapter still consumes the rest of that framework response so
any sibling deferred external calls are correlated before the command waits for server-owned results.

The neutral seam also recognizes three explicit A2UI inputs: rendering begun, surface updated, and
data-model updated. It forwards only an adapter-supplied complete envelope. The default Pydantic AI
adapter emits none of these and this package never invents a surface, component, version, or
coordinate shape. These display-envelope events remain separate from A2UI action elicitation, so a
display projection cannot silently become permission to execute an action.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Model events: [model loop](../model_loop/README.md)
- Attempt execution: [attempts](../attempts/README.md)
