# @opencrane/backend/server/utils — bounded server-only helpers

> [backend](../../../README.md) › [server](../README.md) › utils

## What it owns

This package holds small server-side helpers that are safe to share between OpenCrane server
capabilities but cannot run in a browser. It currently owns the ZIP parsing boundary used by OCI
(Open Container Initiative) image-layout upload admission: the caller receives a catalogue of safe,
regular files and must choose which files are meaningful for its own protocol.

```
untrusted ZIP upload
        │
        ▼
┌──────────────────┐
│ server utils HERE │  safe entry catalogue + bounded reads
└──────────────────┘
        │
        ▼
OCI image admission decides whether the layout is valid
```

**In this flow:** [MCP gateway](../gateways/mcp/main/README.md)

It rejects encrypted entries, ZIP64 archives, duplicate or escaping paths, directory entries and
unsupported compression before a caller can read any content. A parser failure provides no partial
archive: the caller receives `null` and must fail closed.

## Public surface

- `___ParseZipPackage` — reads a safe ZIP central directory and exposes per-entry bounded reads.
- `ZipPackage`, `ZipPackageEntry` — parsed entry metadata and its read boundary.

## Boundary

This package knows ZIP structure only. It does not decide whether a file is an OCI layout, verify a
digest, extract files to disk, or admit an upload.

## Dependency direction

Tagged `scope:shared` and `layer:backend`, it may be used by server capabilities while remaining
Node-only. It never imports an app or a domain authority.

## See also

- Parent index: [server](../README.md)
- Consumer: [MCP gateway](../gateways/mcp/main/README.md)
