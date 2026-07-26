# @opencrane/backend/agents/skills/k8s-launcher — governed skill Job builder

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › k8s-launcher

## What it owns

This package builds the exact Kubernetes Job shape for two isolated Python workloads: a skill
authoring worker and a tenant-authored tool runner. The Job builder is pure: it does not call
Kubernetes, issue capabilities, download artifacts, or execute Python. The agent controller remains
the only process allowed to submit its result to Kubernetes.

```
 durable claim + opaque capability reference
                    │
                    ▼
 ┌───────────────────────────────────────────────┐
 │ skills/k8s-launcher  ◄── HERE                  │ validates fixed image, identity, limits,
 └───────────────────────────────────────────────┘ projected token, scratch, and Job metadata
                    │
                    ▼
 agent controller ──► one isolated Kubernetes Job
```

**In this flow:** [skill catalog authority](../../../server/agents/skills/main/README.md) ·
[agent controller](../../../../../apps/agent-controller/README.md) *(sole Job mutator with narrow
RBAC)* · [agent runtime launcher](../../runtime/k8s-launcher/README.md).

It guarantees a suspended, zero-retry, terminally cleaned, non-privileged Job with a read-only root
filesystem, bounded temporary scratch space, no auto-mounted service-account token, and no source
code, artifact bytes, arguments, or credentials embedded in the manifest. The controller releases it
only after it has durably committed the exact Kubernetes identity. The Job receives an audience-bound
projected token and an opaque bootstrap reference in separate read-only files; the worker can use them
only to acknowledge its own bootstrap endpoint.

## Public surface

- `__BuildGovernedSkillWorkloadJob` — creates the deterministic hardened Job manifest.
- `SkillWorkloadJobAssignment` — durable controller coordinates for one Job.
- `SkillWorkloadJobProfile` — deployment-owned image, identity, resource, and token policy.

## Boundary

The agent controller consumes this builder. It does not make a tool executable, contact the
ArtifactStore, or provide a worker transport; those require the later durable claim/result protocol.
Malformed identity, image, lifetime, namespace, resource, or bootstrap-reference inputs fail before
Kubernetes sees a manifest. The reference must use the fixed opaque grammar, so durable workload
identifiers are never copied into the Job annotation or environment.

## Dependency direction

Tagged `scope:skills-launcher`: it may depend only on itself and shared dependency-light packages.
It never imports an app, the skill catalog, or the control API.

## See also

- Parent index: [skills](../README.md)
- Similar runtime builder: [agent runtime launcher](../../runtime/k8s-launcher/README.md)
- Catalog authority: [server skills](../../../server/agents/skills/main/README.md)
