# @opencrane/backend/server/infra/oci-registry — immutable OCI image import

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › oci-registry

## What it owns

This server infrastructure package copies an admitted Open Container Initiative (OCI) image into
one operator-owned registry repository. Admission runs before this package and supplies the exact
manifest, configuration, and layer bytes with their checked SHA-256 digests. A workflow saves the
returned immutable image address after this package finishes.

```text
checked OCI Image Layout ZIP
        │ manifest + config/layer blobs
        ▼
┌──────────────────────────────┐
│ oci-registry       ◄── HERE  │ HEAD blobs · upload missing · PUT manifest
└──────────────────────────────┘
        │ registry.example/repository@sha256:...
        ▼
OCI admission workflow ........ saves the address for a later MCP runtime claim
```

**In this flow:** the [MCP gateway](../../gateways/mcp/main/README.md) checks the uploaded ZIP before
this adapter receives it. The MCP (Model Context Protocol) runtime later uses the saved image address
without asking this package to launch anything.

The importer checks every supplied digest again before making an external request. It uploads the
manifest last, so the registry never receives a manifest that points to blobs this import has not
stored. A repeated call checks each blob first and safely writes the same manifest digest again.

## Public surface

- `__CreateOciRegistryClient(options)` creates a client fixed to one HTTPS registry and repository.
- `OciRegistryClient.import(plan)` imports checked bytes and returns
  `host/repository@sha256:...` plus the manifest digest.
- `OciRegistryImportError` and `OciRegistryImportErrorCodes` report whether input, transport, or a
  registry response stopped the import without exposing credentials or image bytes.

## Boundary

This package speaks the OCI Distribution HTTP API. It does not parse ZIP files, decide whether an
image is allowed, scan image contents, write database rows, create runtime claims, or start
containers. It accepts no tags and never sends the configured Authorization header to another
origin, even when a registry returns an absolute upload location. It does not follow redirects.

## Dependency direction

This is `layer:infra` with `scope:mcp`. It uses Node hashing and the Fetch API, but it does not
import an application, MCP domain authority, database adapter, or Kubernetes client.

## Runtime & config

The caller supplies an HTTPS registry origin with no path or embedded credentials, one repository
name, a per-request timeout from 1 to 120 seconds, and an optional function that reads the current
Authorization header. The client calls that function for every request so a mounted Secret can
rotate without restarting the server. This package never logs the value.

## See also

- Parent index: [server infrastructure](../README.md)
- Consumer: [MCP gateway and OCI admission workflow](../../gateways/mcp/main/README.md)
- Standard: [OCI Distribution specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)
- Standard: [OCI image manifest specification](https://github.com/opencontainers/image-spec/blob/main/manifest.md)
