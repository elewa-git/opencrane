# tool-runner — isolated sandbox tool jobs

> apps › tool-runner

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that run an already-authorized tenant tool. It does not accept user traffic, invoke a tool, or
choose network destinations. The later durable worker protocol will create exact Jobs through the
agent controller and capability-bound policy.

```
 OpenCrane control plane ── durable claim (later slice) ──► agent controller
                                                            │ creates a suspended Job
                                                            ▼
                                                    tool-runner namespace
                                                    zero-RBAC worker identity
                                                            │ exchanges one capability
                                                            ▼
                                                    bounded tool-result reply
```

**In this flow:** [agent controller](../agent-controller/README.md) *(future sole Kubernetes
mutator)* · [skill launcher](../../libs/backend/agents/skills/k8s-launcher/README.md) *(pure Job
shape)* · OpenCrane *(future capability exchange and result authority)*

## Public surface

- Helm chart — restricted namespace, `tool-runner-default` ServiceAccount, quota, and default-deny policy.
- `values.yaml` — only the namespace name and standard chart labels; controller-owned image,
  capability, resource, and lifecycle values stay unavailable until durable claims exist.

## Boundary

No worker gets Kubernetes API credentials, and default-deny means a future execution path must
declare every permitted destination. No controller currently has RBAC or a profile to create this
Job; the later durable-claim slice must give the agent controller that narrow authority before it
becomes the sole Kubernetes mutator. Until then, this is an inert deployment boundary.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [skill authoring](../skill-authoring/README.md)
