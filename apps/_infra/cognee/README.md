# cognee — offline-ready organisational-memory service

> [apps](../../README.md) › [_infra](../README.md) › cognee

<!-- A vendored-infra app: a pinned third-party product with one OpenCrane-owned image layer and
     Helm wrapper. No import alias. Named by `project.json` (`cognee`). -->

## What it owns

This app owns the release-local Cognee image and Kubernetes deployment contract. Cognee is the
graph-based store that supplies durable organisational context to OpenCrane agents. Each customer
**silo** — one customer's isolated namespace and workloads — gets its own Cognee Deployment,
Service, storage, and network policy.

Before this image is built, the public LadybugDB extension server provides a native json extension.
This app downloads that exact binary once, verifies its checksum, and places it where Cognee expects
it. After deployment, the memory gateway sends admitted requests to Cognee and receives retrieved
context. Cognee startup never needs the public extension server.

```text
 build: LadybugDB extension -- fixed checksum --> Cognee image  ◄── HERE
                                                      |
 deploy: memory gateway -- admitted memory request --> Cognee
                                                      |
                                                      +--> durable silo storage
```

**In this flow:** the [memory gateway](../../memory-gateway/README.md) owns authenticated access;
the [silo chart](../deploy-k8s/README.md) composes the deployment.

The invariant is that the required native extension is already present and byte-for-byte verified
before the image can be published. A wrong download fails the build. A missing extension fails the
offline image smoke. No runtime network exception hides either failure.

## Public surface

- `deploy/Dockerfile` builds the OpenCrane-owned Cognee image.
- `helm/` provides `opencrane.cognee.resources`, the named-template library composed by the silo
  chart.
- `project.json` registers the container, contract-test, offline image-smoke, and Helm-lint targets.

There is no importable application code.

## Boundary

OpenCrane owns how Cognee is built, deployed, reached, and isolated. The vendor owns Cognee's
behaviour and data model. Only the release-local memory gateway may connect to the Cognee Service.
Cognee may reach release-local LiteLLM, cluster DNS, and optional local telemetry, but not
`extension.ladybugdb.com` at runtime.

External or shared Cognee is deliberately unsupported. Disabling the private instance fails chart
rendering rather than bypassing the gateway. Shared LiteLLM is also rejected because a standard
Kubernetes NetworkPolicy cannot safely identify an external endpoint.

## Dependency direction

This is a deployment entrypoint (`type:app`, `layer:entrypoint`, `scope:cognee`). The silo chart
composes it; no package imports it.

## Runtime & config

| Part | Pinned value |
| --- | --- |
| OpenCrane image | `ghcr.io/elewa-git/opencrane-cognee@sha256:…` |
| Upstream base | `cognee/cognee:1.2.1` |
| LadybugDB extension | `json`, LadybugDB `0.17.0`, Linux AMD64 |
| Extension SHA-256 | `8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114` |
| Runtime path | `/root/.lbdb/extension/v0.17.0/linux_amd64/json/libjson.lbug_extension` |

The image is AMD64-only because the extension is a native binary. The Dockerfile fixes the platform
and sets `HOME=/root`, because LadybugDB derives its extension path from `HOME` and Kubernetes does
not add that variable when an image omits it. The image smoke starts LadybugDB without networking and
loads the extension, so a present-but-unusable file cannot pass publication.
The app-owned deployer requires the exact published digest for every real silo and reuses the prior
digest on upgrades. A tag is accepted only for the imported image in the disposable local k3d smoke.
To bump Cognee or LadybugDB, update the base, extension URL, path, checksum, tests, chart dependency,
and release manifest together. Never replace these pins with `latest` or add runtime egress as a
fallback.

- `clustertenantManager.cognee.install` must remain `true`.
- `clustertenantManager.cognee.service.port` defaults to `8000` and feeds the gateway endpoint.
- `clustertenantManager.cognee.persistence.enabled` keeps Cognee's relational, graph, identity, and
  vector data under `/cognee-data` across pod restarts.
- `clustertenantManager.cognee.image.*` selects an immutable release image or local smoke alias.
- `sharedPlatform.litellm.mode` must remain `instance`.
- Cognee's own login middleware stays disabled because the authenticated gateway and NetworkPolicy
  own access to this private Service.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- Sibling infra: [litellm](../litellm/README.md) · [obot](../obot/README.md)
