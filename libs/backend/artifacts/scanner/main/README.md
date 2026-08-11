# artifact scanner — fenced malware worker protocol

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › artifacts › scanner

This package runs one outbound-only scan loop. OpenCrane chooses a quarantined immutable revision,
streams its exact bytes, and accepts a clean or rejected result only through the live attempt fence.

## What it owns

- The projected-token scanner remote.
- Bounded scratch-file processing and cleanup.
- Shell-free ClamAV invocation and public verdict mapping.

It never receives storage coordinates, upload capabilities, malware signature names, or database
access. The server remains the only publication authority.

## Public surface

Import `@opencrane/backend/artifacts/scanner` to compose the remote, ClamAV adapter, and polling loop.

## See also

- [Server artifact authority](../../../server/agents/artifacts/main/README.md)
- [Conversation asset model](../../../../models/conversation-assets/main/README.md)
