# tool-runner — isolated sandbox tool jobs

> apps › tool-runner

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that run an already-authorized tenant tool. It does not accept user traffic, invoke a tool, or
choose network destinations. The later durable worker protocol will create exact Jobs through the
agent controller and capability-bound policy.

## Public surface

- Helm chart — restricted namespace, `tool-runner-default` ServiceAccount, quota, and default-deny policy.

## Boundary

The agent controller remains the only Kubernetes mutator. No worker gets automatic Kubernetes API
credentials, and default-deny means a future execution path must declare every permitted destination.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [skill authoring](../skill-authoring/README.md)
