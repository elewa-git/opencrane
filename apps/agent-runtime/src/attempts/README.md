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
│ attempt step  ◄── HERE │  coordinate loop, continuation, candidates, terminal gate
└────────────┬───────────┘
             ▼
ordered candidate sequence
```

| File | Responsibility |
| --- | --- |
| `continuation.py` | Keeps the one serializable attempt aggregate and validates replacement state. |
| `execution.py` | Validates commands and coordinates model-loop, continuation, and candidate seams. |
| `elicitation_results.py` | Validates exact terminal participant-input results before model resume. |
| `resume_results.py` | Validates and consumes mixed tool and elicitation results atomically. |
| `tool_results.py` | Validates saved terminal tool-result shapes without repeating external work. |
| `terminal.py` | Delivers at most one stable terminal candidate per active attempt. |

Cancellation is a positive local signal; the server remains the durable cancellation authority.
Only one start/resume worker is current at a time, and loss of the command stream cancels every
worker that has not yet returned.

Start and resume suppress `run.completed` while the projector reports any explicit wait reason. A
single command can wait for both an outside action and participant input. The runtime logs only those
fixed category names; it never labels a tool call as approval-required because that decision belongs
to the server.

A combined resume validates every elicitation result before it consumes pending tool-call state.
Answered ordinary input may carry one JSON response. A protected A2UI answer deliberately carries no
response, while declined, expired, cancelled, and failed outcomes are response-free terminal
markers. Unknown fields, duplicate request ids or keys, non-JSON content, and mismatched outcome
shapes fail the whole resume without exposing participant content in logs or error candidates.

Before an attempt waits, the runtime saves the exact compact model history and pending tool or
question correlations through the authenticated control-plane connection. The server encrypts that
continuation. A replacement runtime restores it from a fenced resume command before consuming any
saved result.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Candidate projection: [protocol](../protocol/README.md)
- Command transport: [transport](../transport/README.md)
