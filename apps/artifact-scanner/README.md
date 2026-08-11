# artifact-scanner — isolated malware scanner

> [apps](../README.md) › artifact scanner

This outbound-only worker scans one OpenCrane-selected quarantined revision with pinned offline
ClamAV definitions. It reports only clean, rejected, or a stable failure code through the live job
fence. It has no database, ArtifactStore address, public listener, persistent volume, or signing key.

## What it owns

- Process configuration and telemetry lifecycle.
- The pinned ClamAV runtime image and read-only definitions.
- Composition of the scanner library in bounded scratch storage.

## Public surface

`src/index.ts` is the sole process entrypoint. The app exposes no public API.

## See also

- [Scanner protocol library](../../libs/backend/artifacts/scanner/main/README.md)
- [Server artifact authority](../../libs/backend/server/agents/artifacts/main/README.md)
