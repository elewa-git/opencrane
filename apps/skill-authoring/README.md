# skill-authoring — isolated candidate-skill jobs

> apps › skill-authoring

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that validate candidate skill bundles. It does not publish a skill, execute a tenant tool, store
bundle bytes, or run a standing service. A later controller claim creates each Job from the hardened
builder using only a draft capability.

## Public surface

- Helm chart — restricted namespace, `skill-authoring-default` ServiceAccount, quota, and default-deny policy.

## Boundary

The agent controller is the only Kubernetes mutator. This chart deliberately exposes no route and
does not grant Kubernetes API access to the worker identity. Its default-deny namespace permits a
released authoring Pod only cluster DNS and the OpenCrane internal listener for a one-use bootstrap
acknowledgement. That endpoint TokenReviews the fixed projected-token audience and registered Pod
UID; it returns no capability or workload data.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [tool runner](../tool-runner/README.md)
