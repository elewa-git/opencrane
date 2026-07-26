# skill-authoring — isolated candidate-skill jobs

> apps › skill-authoring

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that validate candidate skill bundles. It does not publish a skill, execute a tenant tool, store
bundle bytes, or run a standing service. A later controller claim creates each Job from the hardened
builder using only a draft capability.

```
 OpenCrane control plane ── durable claim (later slice) ──► agent controller
                                                            │ creates a suspended Job
                                                            ▼
                                                skill-authoring namespace
                                                zero-RBAC worker identity
                                                            │ exchanges one capability
                                                            ▼
                                                bounded validation result
```

**In this flow:** [agent controller](../agent-controller/README.md) *(future sole Kubernetes
mutator)* · [skill launcher](../../libs/backend/agents/skills/k8s-launcher/README.md) *(pure Job
shape)* · OpenCrane *(future capability exchange and result authority)*

## Public surface

- Helm chart — restricted namespace, `skill-authoring-default` ServiceAccount, quota, and default-deny policy.
- `values.yaml` — only the namespace name and standard chart labels; image, capability, resource,
  and lifecycle values remain controller-owned until the durable claim slice enables them.

## Boundary

This chart deliberately exposes no route and grants no Kubernetes API access to the worker identity.
No controller currently has RBAC or a profile to create this Job: that is a fail-closed precondition
for the later durable-claim slice, where the agent controller becomes the sole narrowly-authorized
mutator. A rendered namespace cannot execute work by itself.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [tool runner](../tool-runner/README.md)
