# feat-openclaw-tenant — OpenClaw tenant runtime image

> [apps](../README.md) › feat-openclaw-tenant

<!-- No `@opencrane/*` import alias: this deployable ships a container image, not a TS library.
     Titled by its `project.json` name (`feat-openclaw-tenant`). -->

## Status — deletion boundary (blue, frozen)

This app is **blue** — part of the frozen legacy OpenClaw platform that OpenCrane is replacing. It is
a **deletion target**: it takes maintenance-only changes and is removed wholesale when the owned
TypeScript runtime replacement lands. Do not extend it or build new capabilities on it. New
runtime work belongs on the green (replacement) side, not here.

## What it owns

OpenCrane gives each employee their own assistant, which runs in its own pod. This app owns the
**immutable runtime image** those pods boot from. *Immutable* means the executable code is baked into
the image at build time and never changes at runtime: OpenClaw (the third-party agent runtime) and the
Cognee memory plugin are pinned and installed under `/opt/openclaw` when the image is built, and a pod
never downloads or swaps runtime code after it starts.

It belongs to the per-customer **silo** (one customer's isolated namespace and pods). The OpenCrane
server (`apps/opencrane`) is the operator: it renders each pod's config and contract, and this image is
what those pods run. Its role is the **runtime container**, one step downstream of the operator:

```
 opencrane server ........ renders per-tenant config + effective AccessPolicy contract
        │  ConfigMap · Secret · workload spec
        ▼
 ┌──────────────────────────────────────┐
 │  feat-openclaw-tenant image  ◄── HERE │  entrypoint.sh applies state/config, starts baked runtime
 └──────────────────────────────────────┘
        │  polls the control plane for workspace/skill contract changes (not code)
        ▼
   live employee-assistant pod
```

**In this flow:** [opencrane server](../opencrane/README.md)

**Startup flow** (`deploy/entrypoint.sh`):

```
Pod starts
  └── entrypoint.sh
        1. Verify the required Cognee and LiteLLM connections are configured
        2. Create the persistent state/workspace and ephemeral secret directories
        3. Apply the operator-rendered OpenClaw config and platform-owned workspace files
        4. Seed tenant-editable workspace files only when they do not yet exist
        5. Load the effective AccessPolicy-derived tool rules
        6. Pull entitled skill bundles by digest from the Skill Registry
        7. Start the image-baked OpenClaw gateway and poll for workspace/skill contract changes
```

**Invariant.** The contract poll updates platform-owned workspace guidance and entitled skills only —
never executable code. A runtime or plugin update is a new image build and a normal rollout; rolling
back the image restores the complete pinned pair atomically. If the poll or a skill pull fails, the pod
keeps its last good contract rather than dropping guardrails.

## Storage layout

| Path | Backing | Contents |
|------|---------|----------|
| `/opt/openclaw` | Read-only image layer | Pinned OpenClaw runtime and Cognee plugin |
| `/data/openclaw` | GCS Fuse CSI or PVC fallback | Sessions, uploads, workspace and agent state |
| `/data/secrets` | Memory-backed `emptyDir` | Personal secrets encrypted with the per-tenant key |
| `/config` | ConfigMap | Operator-rendered config, bootstrap contract and workspace seeds |
| `/etc/openclaw/encryption-key` | Kubernetes Secret | Per-tenant encryption key |
| `/tmp` | `emptyDir` | Writable home, cache and refreshed contract copy |

Org and team skills are not mounted from shared storage. The pod pulls only the bundle digests listed in
its effective contract, and the Skill Registry checks entitlement on every read.

## Public surface

`Entrypoint: deploy/entrypoint.sh` (runs inside the built image). There is no importable TypeScript
surface — the deliverable is the container image and its bundled OpenClaw + Cognee runtime.

## Boundary

Runs one employee's assistant, isolated to that tenant. It does **not** decide tool policy (the server
compiles the effective `AccessPolicy`), does not fetch runtime code at startup, and does not share skills
via shared storage. Tenant pods run hardened: non-root, dropped Linux capabilities, no privilege
escalation, runtime-default seccomp, read-only root filesystem, explicit writable data/secret/tmp paths.

## Dependency direction

Tagged as an app entrypoint; it is a self-contained image build and is not imported by any package.

## Runtime & config

| Variable | Purpose |
|----------|---------|
| `OPENCLAW_STATE_DIR` | Persistent state directory, normally `/data/openclaw` |
| `OPENCLAW_SECRETS_DIR` | Ephemeral secret directory, normally `/data/secrets` |
| `OPENCLAW_ENCRYPTION_KEY_PATH` | Per-tenant encryption-key file |
| `OPENCLAW_TENANT_NAME` | Tenant identifier injected by the operator |
| `OPENCRANE_RUNTIME_CONTRACT_PATH` | Bootstrap managed-runtime contract |
| `OPENCRANE_CONTROL_PLANE_URL` | Control-plane origin used for contract refreshes |
| `OPENCRANE_SKILL_REGISTRY_URL` | In-cluster Skill Registry used for entitled bundle pulls |
| `OPENCRANE_MEMORY_BACKEND` / `COGNEE_ENDPOINT` | Required organisational-memory connection |
| `LITELLM_ENDPOINT` | Required model-routing proxy |

The operator selects the image through `TENANT_DEFAULT_IMAGE`, rendered from `tenant.defaultImage` in
the silo Helm values. The checked-in default tag
(`ghcr.io/elewa-git/opencrane-openclaw-tenant:openclaw-2026.6.11-cognee-2026.7.9`) names both pinned
runtime components. Build from the repository root:

```bash
docker build \
  -f apps/feat-openclaw-tenant/deploy/Dockerfile \
  -t ghcr.io/opencrane/tenant:openclaw-2026.6.11-cognee-2026.7.9 .
```

## See also

- Parent index: [apps](../README.md)
- Operator that renders its config: [opencrane server](../opencrane/README.md)
- Silo chart that schedules it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
