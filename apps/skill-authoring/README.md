# skill-authoring — isolated candidate-skill jobs

> apps › skill-authoring

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that validate candidate skill bundles. It does not publish a skill, execute a tenant tool, store
bundle bytes, or run a standing service. A later controller claim creates each Job from the hardened
builder using only a draft capability.

## Public surface

- `deploy/Dockerfile` — builds the authoring worker image from the shared acknowledgement client.
- `src/authoring_worker.py` — private, not-yet-invoked intake primitives that verify and safely extract a candidate bundle.
- Helm chart — restricted namespace, `skill-authoring-default` ServiceAccount, quota, and default-deny policy.

## Boundary

The agent controller is the only Kubernetes mutator. This app exposes no listener and grants no
Kubernetes API access to the worker identity. Its default-deny namespace permits a released authoring
Pod only cluster DNS and the OpenCrane internal listener for its bootstrap acknowledgement, server-brokered
input, and terminal completion. Every endpoint TokenReviews the fixed projected-token audience and
registered Pod UID. The worker receives no ArtifactStore endpoint, credential, or signed lease; the server
selects and streams only the immutable source artifact pinned on its assigned draft revision. The server
refuses compressed candidate bundles larger than 16 MiB before it mints an ArtifactStore read lease,
and returns the pinned SHA-256 address alongside the length so the future validator can verify the
downloaded bytes. The admitted Job reserves at least 64 MiB of ephemeral `/tmp` space for bounded
extraction and offline validation. This image does not author or execute a skill yet.

## Dependency direction

This app owns the authoring image root and deployment contract. Its image copies the dependency-free
skill worker module; no library imports this app.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [tool runner](../tool-runner/README.md)
