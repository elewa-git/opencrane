# tool-runner — isolated sandbox tool jobs

> apps › tool-runner

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that run an already-authorized tenant tool. It does not accept user traffic, invoke a tool, or
choose network destinations. The later durable worker protocol will create exact Jobs through the
agent controller and capability-bound policy.

## Public surface

- `deploy/Dockerfile` — builds the tool-runner worker image from the shared acknowledgement client.
- Helm chart — restricted namespace, `tool-runner-default` ServiceAccount, quota, and default-deny policy.

## Boundary

The agent controller remains the only Kubernetes mutator. No worker gets automatic Kubernetes API
credentials, and default-deny means a future execution path must declare every permitted destination.
The only current exception is cluster DNS plus the OpenCrane internal listener for a one-use bootstrap
acknowledgement. The endpoint TokenReviews the registered Pod identity and returns no capability or
workload data. This image does not execute tenant tools yet.

## Dependency direction

This app owns the tool-runner image root and deployment contract. Its image copies the dependency-free
skill worker module; no library imports this app.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [skill authoring](../skill-authoring/README.md)
