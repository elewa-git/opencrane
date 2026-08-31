# Run the bounded model loop

> [agent-runtime](../../README.md) › model loop

This package adapts the attempt-scoped Pydantic AI loop into framework-neutral events. It converts
Pydantic message history to compact JSON inside the continuation owned by `attempts/`.

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
| `driver.py` | Owns model construction, zero-retry policy, framework event translation, and safe steering. |
| `openai_generated_outputs.py` | Maps admitted OpenAI capabilities and final provider events into queued or in-memory neutral outputs. |
| `openai_container_files.py` | Retrieves queued OpenAI container files once with the attempt-scoped client and returns no provider metadata. |
| `generated_output_policy.py` | Owns the provider-neutral file limits, byte classification, safe names, batch validation, and output order. |

The loop cannot execute tools or make its continuation authoritative. Server-compiled tool
schemas are exposed through Pydantic AI's execution-free `ExternalToolset`; every proposed call is
handed back as a neutral event and must cross server admission, approval, and worker authority.
The execution-free model toolset always includes `opencrane_request_input`, even when the run has no
compiled external tools. Its Pydantic call id is retained only to correlate the server-owned
elicitation result back into the same deferred-tool history. On resume, exact validated
participant-input results share the existing `DeferredToolResults` mapping. Ordinary answer content
is never logged; protected A2UI answers arrive only as redacted terminal markers.
Completed Pydantic `FilePart` values become neutral generated-output
events only after the whole response stays within ten files, 200 MiB total, and the approved media
types. The immutable compiled route alone enables pinned PNG image generation or code execution.
Code-execution annotations first become private container-file references in the provider adapter.
The container transport downloads those references through the official zero-retry OpenAI client,
then the neutral policy admits only magic-verified bytes and validates the complete batch before
publication. Provider capability code never owns transport, transport never selects capabilities,
and neutral file policy never sees provider IDs, annotations, headers, response bodies, or
credentials.

## See also

- Source architecture: [component overview](../README.md)
- Parent: [agent-runtime](../../README.md)
- Proof binding: [bootstrap](../bootstrap/README.md)
- Candidate projection: [protocol](../protocol/README.md)
