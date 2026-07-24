# backend-agents-skills-worker — governed worker bootstrap client

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › worker

## What it owns

This small Python module is the common first process step for the isolated skill-authoring and
tool-runner images. A worker reads its short-lived Kubernetes projected token and its opaque
bootstrap reference from read-only files, then sends exactly one acknowledgement to the OpenCrane
internal service. The acknowledgement proves that the released, registered Pod has started; it does
not grant a capability, return a workload identity, or start skill execution.

## Public surface

- `bootstrap.py` — command-line entrypoint and dependency-free acknowledgement client used by both
  worker images.
- `acknowledge(...)` — focused test seam that sends the fixed request and accepts only the minimal
  acknowledgement response.

## Boundary

The module has no listener, Kubernetes client, database connection, ArtifactStore client, result
protocol, execution engine, or general HTTP facility. Redirects, missing projected files, non-200
responses, and any response other than `{ "acknowledged": true }` fail the Job. The server remains
the authority for the one-use consume and exact Pod identity check.

## Dependency direction

This dependency-free `scope:skills` backend library is copied into the two app-owned image roots.
It never imports an app or a server authority; the apps only provide the deployable container
boundary.

## Runtime & config

- `OPENCRANE_SKILL_BOOTSTRAP_URL` — deployment-owned internal OpenCrane base path.
- `OPENCRANE_SKILL_TOKEN_PATH` — read-only rotating projected-token file.
- `OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH` — read-only downward-API reference file.

All three are fixed by the admitted Job shape rather than supplied by a skill or user request.

## See also

- Parent group: [skills](../README.md)
- Job contract: [k8s launcher](../k8s-launcher/README.md)
- Worker image: [skill authoring](../../../../../../apps/skill-authoring/README.md) and
  [tool runner](../../../../../../apps/tool-runner/README.md)
