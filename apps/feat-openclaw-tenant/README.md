# OpenClaw tenant runtime

This app owns the **immutable OpenClaw runtime image** used by each employee-assistant pod.
OpenClaw and the Cognee memory plugin are pinned and installed under `/opt/openclaw` when the
image is built; pod startup never downloads or replaces executable runtime code.

## Startup flow

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

The contract poll updates platform-owned workspace guidance and entitled skills. It does not
change the executable runtime. A runtime or plugin update is a new image build and a normal
workload rollout; rolling back the image restores the complete pinned pair atomically.

## Storage layout

| Path | Backing | Contents |
|------|---------|----------|
| `/opt/openclaw` | Read-only image layer | Pinned OpenClaw runtime and Cognee plugin |
| `/data/openclaw` | GCS Fuse CSI or PVC fallback | Sessions, uploads, workspace and agent state |
| `/data/secrets` | Memory-backed `emptyDir` | Personal secrets encrypted with the per-tenant key |
| `/config` | ConfigMap | Operator-rendered config, bootstrap contract and workspace seeds |
| `/etc/openclaw/encryption-key` | Kubernetes Secret | Per-tenant encryption key |
| `/tmp` | `emptyDir` | Writable home, cache and refreshed contract copy |

Org and team skills are not mounted from shared storage. The pod pulls only the bundle digests
listed in its effective contract, and the Skill Registry checks entitlement on every read.

## Runtime configuration

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

The operator selects the image through `TENANT_DEFAULT_IMAGE`, rendered from
`tenant.defaultImage` in the silo Helm values. The checked-in default tag names both pinned
runtime components.

## Tool and skill policy

A tenant binds to an `AccessPolicy` through `spec.policyRef`, a matching selector, or the
operator default. The control plane compiles that effective policy with the tenant's grants and
serves the resulting MCP allow/deny set and entitled skill digests in the effective contract.
There is no separate tenant-local tool-policy field.

## Hardening baseline

Tenant pods run as non-root with dropped Linux capabilities, disabled privilege escalation,
runtime-default seccomp, a read-only root filesystem, and explicit writable data, secret and
temporary paths.

## Files

```
deploy/
├── Dockerfile          # Builds the pinned immutable runtime image
└── entrypoint.sh       # Applies data/config state and starts the baked runtime

config/
└── base-openclaw-config.json   # Base operator-rendered OpenClaw configuration
```

Build from the repository root:

```bash
docker build \
  -f apps/feat-openclaw-tenant/deploy/Dockerfile \
  -t ghcr.io/opencrane/tenant:openclaw-2026.6.11-cognee-2026.7.9 .
```
