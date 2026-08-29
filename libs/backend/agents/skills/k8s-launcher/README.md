# @opencrane/backend/agents/skills/k8s-launcher — skill-authoring validation Job builder

> [backend](../../../../README.md) › [agents](../../../README.md) › [skills](../README.md) › k8s-launcher

## What it owns

This package builds the exact Kubernetes Job shape for the isolated Python skill-authoring worker.
The Job builder is pure: it does not call
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
only to acknowledge the deployment-selected cluster-local bootstrap endpoint. Authoring Jobs require at least
128 MiB of scratch. The validator uses that space for the uploaded archive, extracted files, and
offline checks without using permanent storage.

## Public surface

- `__BuildSkillAuthoringValidationJob` — creates the deterministic hardened Job manifest.
- `SkillAuthoringValidationJobAssignment` — durable controller coordinates for one Job.
- `SkillAuthoringValidationJobProfile` — deployment-owned image, identity, resource, and token policy.

## Boundary

The agent controller consumes this builder for authoring-package validation. It does not make a
published code skill executable; that remains unavailable until a separate execution protocol is
built.
Malformed identity, image, lifetime, namespace, resource, bootstrap-endpoint, or bootstrap-reference
inputs fail before Kubernetes sees a manifest. The reference must use the fixed opaque grammar, so readable durable
workload identifiers are not repeated in the worker's bootstrap input or environment. Job annotations retain only
bounded job and silo trace coordinates alongside that opaque reference.

## Dependency direction

Tagged `scope:skills-launcher`: it may depend only on itself and shared dependency-light packages.
It never imports an app, the skill catalog, or the control API.

## See also

- Parent index: [skills](../README.md)
- Similar runtime builder: [agent runtime launcher](../../runtime/k8s-launcher/README.md)
- Catalog authority: [server skills](../../../server/agents/skills/main/README.md)
