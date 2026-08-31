# artifact-scanner — isolated malware scanner

> [apps](../README.md) › artifact scanner

This outbound-only worker scans one OpenCrane-selected quarantined revision with pinned offline
ClamAV definitions. It reports only clean, rejected, or a stable failure code through the live job
fence. It has no database, ArtifactStore address, public listener, persistent volume, or signing key.

## What it owns

This worker is the safety gate between an uploaded conversation file and its publication. The
server first quarantines immutable bytes and creates a fenced scan job. This app downloads only
those brokered bytes, scans the complete file in bounded scratch storage, then returns a clean or
rejected result before the server publishes or refuses the revision.

```text
 quarantined upload -> server scan claim -> [artifact-scanner] -> clean / rejected
                                               |
                                      pinned offline definitions
```

In this flow: [conversation assets](../../libs/backend/server/conversation-assets/main/README.md) and
the [server artifact authority](../../libs/backend/server/agents/artifacts/main/README.md) own the
durable rows and publication decision.

The app guarantees that it scans the complete claimed byte length with the pinned ClamAV engine.
An expired claim, partial download, scanner error, or size breach fails closed and publishes no file.

## Public surface

`src/index.ts` is the sole process entrypoint. The app exposes no public API.

## Boundary

The app receives a short-lived projected Kubernetes identity and brokered bytes only. It has no
database access, ArtifactStore address, public listener, durable volume, signing key, or Kubernetes
permissions. The OpenCrane server remains the only publication authority.

## Dependency direction

The `scope:artifacts` entrypoint may compose the scanner, observability, contracts, model, and
utility packages. Libraries never import this app.

## Runtime & config

The Helm chart deploys the app into its own restricted namespace with a bounded `emptyDir` scratch
volume. It requires an immutable image digest; scanner engine and definition files are pinned in
that image. The `image-smoke` target starts the image's normal command without networking or
OpenCrane configuration. Startup must reach the first required configuration check rather than fail
to load a runtime package. The same target runs as UID 65532, scans a clean fixture and the EICAR test
signature, and proves the configured engine and definition paths. The Deployment must remain
available continuously for ten seconds before its rollout succeeds, so a transient process start
cannot qualify the scanner. Poll, request, source-size, scan-timeout, claim, and scratch limits are
deployment values.

## See also

- [Scanner protocol library](../../libs/backend/artifacts/scanner/main/README.md)
- [Server artifact authority](../../libs/backend/server/agents/artifacts/main/README.md)
- [Apps index](../README.md)
