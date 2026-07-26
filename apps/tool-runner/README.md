# tool-runner — isolated sandbox tool jobs

> apps › tool-runner

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that run an already-authorized tenant tool. It does not accept user traffic, invoke a tool, or
choose network destinations. The controller creates exact Jobs through the durable claim and
capability-bound policy.

```
 OpenCrane control plane ── durable claim ──► agent controller
                                                            │ creates a suspended Job
                                                            ▼
                                                    tool-runner namespace
                                                    zero-RBAC worker identity
                                                            │ exchanges one capability
                                                            ▼
                                                    bounded tool-result reply
```

**In this flow:** [agent controller](../agent-controller/README.md) *(sole Kubernetes mutator)* ·
[skill launcher](../../libs/backend/agents/skills/k8s-launcher/README.md) *(pure Job shape)* ·
OpenCrane *(bootstrap acknowledgement authority)*

## Public surface

- Helm chart — restricted namespace, `tool-runner-default` ServiceAccount, quota, and default-deny policy.
- `values.yaml` — namespace, worker ServiceAccount, and quota defaults only; controller-owned image,
  resource, and lifecycle values stay outside the tenant-controlled chart contract.

## Boundary

The agent controller remains the only Kubernetes mutator. No worker gets automatic Kubernetes API
credentials, and default-deny means a future execution path must declare every permitted destination.
The only current exception is cluster DNS plus the OpenCrane internal listener for a one-use bootstrap
acknowledgement. The endpoint TokenReviews the canonical worker Pod identity and returns no capability or
workload data.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [skill authoring](../skill-authoring/README.md)
