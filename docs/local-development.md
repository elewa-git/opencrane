# Local development tiers

OpenCrane has three development loops. Start with the lowest tier that proves the change, then move
up only when the work crosses that tier's boundary.

| Tier | Use it for | Command | Typical host |
| --- | --- | --- | --- |
| 1 | Routed UI, browser state, components, and deterministic failures | `npm run serve:opencrane-ui` | Any Node development machine |
| 2 | Real API, PostgreSQL persistence, run admission, and local Agent execution | `npm run dev:tier2` | A machine with Docker and 4–6 GB free memory |
| 3 | Helm, Kubernetes identity, NetworkPolicy, migrations, and the full silo | `npm run dev:tier3` | Minimum: 4 cores, 16 GB memory, 32 GB storage; recommended: 8 cores, 32 GB memory, 64 GB storage |

## Tier 1: browser-only frontend

Tier 1 runs onboarding, first chat, conversation work, files, approvals, run progress, and child
Agent threads against one disposable browser lifecycle. It also starts Storybook and its Playwright
visual checks. It does not need PostgreSQL, an API process, Docker, or Kubernetes.

```bash
npm run serve:opencrane-ui
```

Use the named Nx configurations to select a reviewed Commander, Catalyst, Anchor, or Analyst
Guardian path. The [contributor guide](../website/contributing/frontend-development.md) lists the
configurations and deterministic URL scenarios.

## Tier 2: local application

Tier 2 starts PostgreSQL 17, applies the target baseline, seeds a signed local membership, watches
the real server, and runs the UI with live gateways and a fixed local identity.

```bash
npm run dev:tier2
```

The core profile leaves models, memory, files, channels, integrations, Obot, Cognee, and Kubernetes
disabled. Add normal Agent admission and execution with:

```bash
npm run dev:tier2 -- --profile agent --alternative simulated-llm
```

Replace `simulated-llm` with `local-llm` for the pinned local LiteLLM container, or `remote-llm`
with its required HTTPS endpoint and admin-key file. Tier 2 never silently moves between those
credential boundaries.

## Tier 3: full k3d silo

Tier 3 reuses the same current-silo smoke that blocks `develop`. It builds the affected application
images, creates a k3d cluster, installs the pinned cluster controllers, deploys through the app-owned
release script, and proves database isolation, TLS ingress, enabled workloads, and storage. The
coordinator forces `KEEP_CLUSTER=1`, so the qualified cluster remains available for inspection after
the smoke finishes.

Open the repository in its devcontainer, preferably in a GitHub Codespace. The image uses native
Linux amd64 and installs the versions used by the smoke job: Node 24, Helm v4.1.4, k3d v5.8.3, and
kubectl v1.30.10. Docker runs inside the container. The configuration enforces a minimum of 4 cores,
16 GB of memory, and 32 GB of storage so Codespaces can offer smaller machines. The full silo uses
approximately 6 CPUs, 10–12 GB of memory, and 25–30 GB of storage, so 4-core machines may be slower
and the 32-GB disk leaves little room for image and build-cache growth. Use the recommended 8-core,
32-GB-memory, 64-GB-storage machine for full qualification and repeated builds.

```bash
npm run dev:tier3
```

Tier 3 protects the minimum disk by reclaiming reusable BuildKit cache until Docker has 8 GB free,
importing the images into k3d one at a time, and deleting each Docker-side source after a successful
import. The retained k3d copy remains available. This avoids the peak double-copy that
otherwise fills a 32-GB Codespace. On the recommended 64-GB machine, preserve the reusable build
cache and use the faster batch import with `SMOKE_LOW_DISK_IMAGE_IMPORT=0 npm run dev:tier3`.
The contributor command allows 600 seconds for workload readiness unless `TIMEOUT_SECONDS` supplies
another reviewed value.

After qualification, the command listens on `127.0.0.1:4200`. In Codespaces, open the forwarded
port labelled **OpenCrane Tier 3** and keep its visibility private. The local proxy preserves the
browser's `*.app.github.dev` origin while sending the smoke's `.test` host to ingress, so the SPA,
`/api`, `/gateway`, and WebSocket routes all use the real chart routing. Port-forwarding only the
SPA service is not enough: its nginx container deliberately does not proxy application routes.

Use fast local-path storage when the change does not concern storage expansion:

```bash
npm run dev:tier3 -- --storage-mode fast
```

Use `--smoke-only` when a browser is unnecessary. To stop the retained cluster after diagnosis,
run `k3d cluster delete opencrane-develop-smoke`. The command names that one disposable cluster and
does not touch Tier 2 containers or volumes.

## Codespaces prebuilds

The devcontainer runs `npm ci` during creation, so a repository administrator can enable a
Codespaces prebuild for this configuration and cache the lockfile-bound workspace dependencies.
Prebuilds consume Actions minutes and storage; keep them for branches that regularly need Tier 3.
The Docker-in-Docker data volume remains Codespace-local and is not part of a prebuild.

## Qualification boundary

Tier 3 proves the full disposable silo on k3d. It does not qualify production DNS, public
certificates, cloud workload identity, backup and restore, or an upgrade of a real tenant. Those
remain remote deployment and release evidence under the repository's deploy workflow.

See also: [build, test, and infrastructure guidance](agents/infra.md), [cluster architecture](agents/cluster-architecture.md), and [CI and deploy flow](ci-and-deploy.md).
