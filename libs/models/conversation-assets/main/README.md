# Conversation assets — shared file policy

> [OpenCrane](../../../../README.md) › [models](../../README.md) › conversation assets

This pure package names the durable conversation-file lifecycle and applies the same attachment
limits in browser and server code. A message may contain at most ten supported files and 200 MiB
in total. PDF, PNG, and MP3 can be previewed; DOCX, XLSX, and ZIP are download-only. SQLite and
unknown formats are rejected.

It contains no storage coordinates, upload leases, scan evidence, or infrastructure details.

## What it owns

- The browser-safe lifecycle and provenance vocabulary.
- The supported-media and preview/download policy.
- The ten-file and 200 MiB per-message admission rule.

## Public surface

Import `@opencrane/models/conversation-assets` for the enums, limits, and pure policy functions.

## See also

- [Artifact model](../../artifacts/main/README.md)
- [Conversation model](../../conversations/main/README.md)
