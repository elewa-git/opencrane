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
| `elicitation_results.py` | Validates exact terminal participant-input results before model resume. |
| `pending_tools.py` | Keeps same-attempt external tool-call correlation until one server result consumes it. |
| `pending_elicitations.py` | Keeps bounded request-key-to-framework-call correlation for participant input. |
| `resume_results.py` | Validates and consumes mixed tool and elicitation results atomically. |
| `tool_results.py` | Validates saved terminal tool-result shapes without repeating external work. |
| `terminal.py` | Delivers at most one stable terminal candidate per active attempt. |

Cancellation is a positive local signal; the server remains the durable cancellation authority.
Only one start/resume worker is current at a time, and loss of the command stream cancels every
worker that has not yet returned.

A combined resume validates every elicitation result before it consumes pending tool-call state.
Answered ordinary input may carry one JSON response. A protected A2UI answer deliberately carries no
response, while declined, expired, cancelled, and failed outcomes are response-free terminal
markers. Unknown fields, duplicate request ids or keys, non-JSON content, and mismatched outcome
shapes fail the whole resume without exposing participant content in logs or error candidates.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Candidate projection: [protocol](../protocol/README.md)
- Command transport: [transport](../transport/README.md)
