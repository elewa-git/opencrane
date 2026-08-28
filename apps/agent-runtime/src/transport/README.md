# Exchange commands and candidates

> [agent-runtime](../../README.md) › transport

This package owns the runtime's only network boundary: outbound bootstrap/candidate HTTP and the
authenticated server-sent command stream. It accepts no inbound connections and keeps retry,
frame-size, stream-loss, and cancellation behaviour bounded.

```text
OpenCrane control plane
       │ commands
       ▼
┌──────────────────────┐
│ transport  ◄── HERE  │  parse bounded frames and post stable candidates
└──────────┬───────────┘
           │ candidates
           ▼
OpenCrane control plane
```

| File | Responsibility |
| --- | --- |
| `http.py` | Sends candidates and bounded continuations over authenticated JSON. |
| `stream.py` | Parses bounded command frames and dispatches attempt workers. |

A dropped stream signals the active attempt to stop. The transport never persists commands or opens
an inbound listener. Clean EOF and exceptional disconnects share bounded reconnect backoff. Ordinary
candidates are not retried; terminal candidates alone reuse their stable identifier after ambiguous
network loss, but never after an explicit HTTP refusal. A waiting continuation is also safe to replay:
the transport retries the exact same revision until the server accepts it or the attempt is cancelled.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Bootstrap caller: [bootstrap](../bootstrap/README.md)
- Attempt handler: [attempts](../attempts/README.md)
