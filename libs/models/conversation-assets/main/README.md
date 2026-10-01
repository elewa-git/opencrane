# @opencrane/models/conversation-assets — shared file policy

> [OpenCrane](../../../../README.md) › [models](../../README.md) › conversation assets

## What it owns

This pure package names the durable conversation-file lifecycle and applies the same attachment
limits in browser and server code. A message may contain at most ten supported files and 200 MiB
in total. PDF, PNG, and MP3 can be previewed; CSV, DOCX, XLSX, and ZIP are download-only. CSV uses
`text/csv` or the generator's exact `text/csv;charset=utf-8` media type. Other encodings, SQLite,
and unknown formats are rejected. A supported media type never supplies upload or read authority;
the server still requires the existing authorization and clean-scan evidence.

It owns the browser-safe lifecycle and provenance vocabulary, supported-media and preview/download
policy, and ten-file/200 MiB per-message admission rule. The `generated-csv/` folder owns the
shared CSV argument schema, limits and deterministic renderer. Both the isolated producer and
server capture use it: a scanner verdict does not establish spreadsheet formula safety.

## Public surface

Import `@opencrane/models/conversation-assets` for the enums, limits, and pure policy functions.
`___CreateCsvFile` validates a filename, unique headers and rectangular scalar rows, rejects
formula-leading strings and control characters, and returns at most 1 MiB of UTF-8 CSV. Negative
numeric cells remain numbers. `GENERATED_CSV_INPUT_SCHEMA` is the same argument contract exposed
by the MCP producer. `GENERATED_CSV_TOOL_NAME` is the discovery and runtime name shared by the
isolated producer and server capture. The server compiler owns the separate model declaration name
for each admitted revision.

## Boundary

This package contains no storage coordinates, upload leases, scan evidence, framework state, or
infrastructure details. Server and browser adapters enforce its pure decisions at their own trust
boundaries.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:model`, it is the lowest layer of this capability and
imports no framework, transport, persistence, or app package. The additional
`scope:conversation-assets-model` tag lets the MCP runtime reuse this pure package without opening
dependencies on the conversation-assets server or frontend packages.

## See also

- [Artifact model](../../artifacts/main/README.md)
- [Conversation model](../../conversations/main/README.md)
