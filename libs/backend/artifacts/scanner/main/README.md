# @opencrane/backend/artifacts/scanner — fenced malware worker protocol

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › artifacts › scanner

## What it owns

This package runs one outbound-only scan loop. OpenCrane chooses a quarantined immutable revision,
streams its exact bytes, and accepts a clean or rejected result only through the live attempt fence.
It owns the projected-token remote, bounded scratch-file processing and cleanup, and shell-free
ClamAV invocation with public verdict mapping.

```text
 server claim -> brokered bytes -> [scanner loop] -> clean / rejected -> server
```

In this flow: the [server artifact authority](../../../server/agents/artifacts/main/README.md) owns
the durable job, source selection, retry policy, and publication decision.

## Public surface

Import `@opencrane/backend/artifacts/scanner` to compose the remote, ClamAV adapter, and polling loop.

## Boundary

It never receives storage coordinates, upload capabilities, malware signature names, signing keys,
or database access. The server remains the only publication authority, and any partial read or
engine failure returns a bounded failure through the current fence.

## Dependency direction

Tagged `scope:artifacts` and `layer:backend`, it may depend on the artifact model, shared scanner
contracts, and observability. Apps compose it; it never imports an app or server authority.

## See also

- [Server artifact authority](../../../server/agents/artifacts/main/README.md)
- [Conversation asset model](../../../../models/conversation-assets/main/README.md)
