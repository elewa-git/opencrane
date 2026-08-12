# @opencrane/models/conversation-assets — shared file policy

> [OpenCrane](../../../../README.md) › [models](../../README.md) › conversation assets

## What it owns

This pure package names the durable conversation-file lifecycle and applies the same attachment
limits in browser and server code. A message may contain at most ten supported files and 200 MiB
in total. PDF, PNG, and MP3 can be previewed; DOCX, XLSX, and ZIP are download-only. SQLite and
unknown formats are rejected.

It owns the browser-safe lifecycle and provenance vocabulary, supported-media and preview/download
policy, and ten-file/200 MiB per-message admission rule.

## Public surface

Import `@opencrane/models/conversation-assets` for the enums, limits, and pure policy functions.

## Boundary

This package contains no storage coordinates, upload leases, scan evidence, framework state, or
infrastructure details. Server and browser adapters enforce its pure decisions at their own trust
boundaries.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:model`, it is the lowest layer of this capability and
imports no framework, transport, persistence, or app package.

## See also

- [Artifact model](../../artifacts/main/README.md)
- [Conversation model](../../conversations/main/README.md)
