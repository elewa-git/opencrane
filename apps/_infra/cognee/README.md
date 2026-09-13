# cognee — qualified organisational-memory provider

> [apps](../../README.md) › [_infra](../README.md) › cognee

<!-- A vendored-infra app: a pinned third-party product with one OpenCrane-owned image layer and
     Helm wrapper. No import alias. Named by `project.json` (`cognee`). -->

## What it owns

This app owns the release-local Cognee image and Kubernetes deployment contract. Each customer
**silo**, meaning one customer's isolated namespace and workloads, gets one Cognee process and one
shared persistent local volume. The memory gateway is its only network caller and logs in as one
service user for that silo.

```text
 reviewed Cognee source + fixed repairs ──► qualified provider image
                                                   │
 OpenCrane server ──► memory gateway ── login ─────┤
                                                   ▼
                                      Cognee + persistent volume  ◄── HERE
```

**In this flow:** [OpenCrane](../../opencrane/README.md) ·
[memory gateway](../../memory-gateway/README.md) ·
[silo chart](../deploy-k8s/README.md).

The provider must preserve shared memberships and delete an unreferenced local source before its
relational deletion commits. A cleanup or commit failure therefore retains the exact document and
dataset coordinate needed for a safe retry. The same image also repairs dataset ACL creation and
binds Cognify retries to a saved input digest and operation identifier.

## Public surface

- `deploy/Dockerfile` builds the selected provider image from the immutable upstream base.
- `deploy/provider-profile.json` records the upstream source, platform, native extension and every
  patched module's reviewed hashes.
- `deploy/patches/` contains the exact source repairs and the fail-closed patch applicator.
- `helm/` provides `opencrane.cognee.resources` for the silo chart.
- `project.json` exposes fast source tests, image checks and the Docker-backed
  `cognee:memory-contract` qualification.

There is no importable application code.

## Boundary

OpenCrane owns how Cognee is built, deployed, authenticated and isolated. Cognee owns memory content
and its provider data model. All product reads and writes still pass through OpenCrane's memory
gateway port; no application calls Cognee directly.

This selected profile is intentionally narrow: one worker, one replica, Cognee's local SQLite
relational store and one shared local file volume. Managed-file operations share an operating-system
file lock across processes; dataset locks remain process-local. The qualification makes no safety
claim for multiple workers, multiple replicas,
remote storage, a shared database, or independent databases that share files.

## Dependency direction

This is a deployment entrypoint tagged `type:app`, `layer:entrypoint`, `scope:cognee`. The silo
chart composes it; no package imports it.

## Runtime & config

| Part | Selected value |
| --- | --- |
| Upstream source | Cognee `v1.5.4`, commit `20e0bd88746de2d96e99b4b122361dfc3dad21bc` |
| Linux AMD64 base | `sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10` |
| Runtime identity | UID/GID `1000` (`cognee`) |
| LadybugDB extension | `json` for LadybugDB `0.19.0` |
| Extension SHA-256 | `39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426` |
| Runtime extension path | `/app/.lbdb/extension/0.19.0/linux_amd64/json/libjson.lbug_extension` |

The image copies the native extension during its networked build, verifies the checksum, and proves
that it loads while the smoke container has no network. Each source repair checks the immutable
upstream preimage, patch digest and resulting postimage before the image can build.

The chart fixes one Cognee replica and the SQLite relational provider, requires persistent storage,
and enables
`ENABLE_BACKEND_ACCESS_CONTROL` and `REQUIRE_AUTHENTICATION`. The gateway reads the service-user
email and password from a pre-created Secret mounted as files. First-install registration remains
disabled by default and requires an explicit, reviewed deployment override.

Cognee's chat and embedding calls use the silo's release-local LiteLLM proxy. Keep
`LLM_MODEL=openai/auto`, `EMBEDDING_PROVIDER=openai_compatible`, and
`EMBEDDING_MODEL=auto-embedding`; the provider sends those model strings as configured.

Run `npm exec -- nx run cognee:test` for source and policy checks. CI runs
`npm exec -- nx run cognee:memory-contract` on a Docker runner. That full journey uses synthetic
content and fresh disposable storage to prove authentication, dataset isolation, useful recall,
source identity, shared-reference retention, last-reference erasure, interrupted cleanup retry,
restart recovery, concurrent add/delete, dataset ACL recovery and Cognify replay evidence.

The contract retains content-free coordinates, digests, source hashes and failure receipts under
`.nx/test-results/cognee-memory-contract`. A successful earlier image qualification does not
qualify a later cleaned source revision; the exact image produced from the final revision must run
this contract again before testv6 promotion.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- Memory gateway: [memory-gateway](../../memory-gateway/README.md)
- Sibling infra: [litellm](../litellm/README.md)
