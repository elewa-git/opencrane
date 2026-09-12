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
- `project.json` registers the container, fast contract tests, offline image smoke, memory-provider
  qualification, and Helm-lint targets.

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
| Upstream base | `cognee/cognee:1.2.1@sha256:08216665edfbfb1509f1fe866f9e3ff14c1aa930cd2d0d06e81e6549382519a1` |
| LadybugDB extension | `json`, LadybugDB `0.17.0`, Linux AMD64 |
| Extension SHA-256 | `8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114` |
| Runtime path | `/root/.lbdb/extension/0.17.0/linux_amd64/json/libjson.lbug_extension` |

The image is AMD64-only because the extension is a native binary. The Dockerfile fixes the platform
and sets `HOME=/root`, because LadybugDB derives its extension path from `HOME` and Kubernetes does
not add that variable when an image omits it. LadybugDB's download URL includes `v0.17.0`, while its
local loader directory is `0.17.0` without the `v`; keep those distinct. The image smoke starts
LadybugDB without networking and loads the extension, so a present-but-unusable file cannot pass
publication.
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

## Provider qualification

Run `npm exec -- nx run cognee:memory-contract` on the CI Docker runner to test the pinned image's
memory behavior with synthetic facts. The target builds the app-owned image, then runs Cognee and
a deterministic model/embedding stub on a private Docker network. It records the installed provider
version and source hashes before checking dataset isolation, document identity, recovery after a lost
response, restart, indexing and deletion. The driver uses container DNS without publishing a host
port. The harness removes only its own containers, network and temporary storage.
The pinned image reports `1.2.1-local`: Cognee appends this suffix when it reads the version from its
source checkout. Qualification requires that exact value and the reviewed module hashes.

The negative control tests the current configuration, with dataset partitioning and HTTP login
disabled. The positive candidate enables both: Cognee requires authentication when partitioning is
enabled. It registers a synthetic account in disposable storage and signs in again after restart;
the test token stays in process memory and never enters evidence files.
Authenticated search must identify the exact requested dataset in its response envelope. The
negative control uses the provider's separate flat response shape; neither parser accepts the
other mode or silently selects from several datasets.
A passing provider proof is required before changing the deployment default or enabling personal
memory writes. An empty result cannot stand in for an
unavailable provider, a lost response cannot authorize another write, and a chunk identifier cannot
stand in for the owning document during deletion.

The pinned 1.2.1 image currently fails the last-reference erasure check: it removes retrieval and
dataset visibility but retains the original uploaded file. Its authenticated candidate passes
isolation and restart recovery; that does not qualify deletion or enable personal memory. Keep the
failed evidence and test assertion until a separately reviewed provider image passes the complete
contract, including interrupted-deletion recovery and local file ownership.

CI selects this uncached target whenever the existing image-smoke selection includes Cognee. A
selected run fails if Docker or a required provider proof is unavailable. Logs and a machine-readable
result are retained under `.nx/test-results/cognee-memory-contract` and uploaded by the workflow.
The ordinary `cognee:test` target stays fast and does not require Docker.

To evaluate the proposed 1.5.4 replacement, run `npm exec -- nx run cognee:memory-contract-1-5-4`
on the CI Docker runner. Its Dockerfile and immutable image profile live under
`tests/candidates/1.5.4/`; it creates fresh disposable storage and keeps its own evidence under
`.nx/test-results/cognee-memory-contract-1-5-4`. The separate CI job retains failures as well as
successful checks. It does not register a release image or satisfy the production publication gate.

The shared-content check records document/chunk coordinates from the dataset graph separately from
the ranked search response. Those coordinates survive a failed assertion without retaining source
text. Use them to distinguish missing document association from a search-ranking result; a bounded
search response cannot enumerate every chunk belonging to a document. This evidence does not relax
the candidate's existing assertions or qualify the provider by itself.

The candidate changes dataset and native-database behavior, so its qualification must include the
full provider journey and deletion recovery. A successful ordinary delete alone does not establish
safe local file ownership or recovery after an interrupted cleanup. Selecting a production image,
changing chart defaults and enabling personal memory are later reviewed changes.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- Sibling infra: [litellm](../litellm/README.md)
