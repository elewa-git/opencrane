# skill-authoring — isolated candidate-skill jobs

> apps › skill-authoring

## What it owns

This deployment-only package owns the isolated namespace and zero-RBAC identity for one-off Python
Jobs that validate candidate skill bundles. It does not publish a skill, execute a tenant tool, store
bundle bytes, or run a standing service. The controller creates each Job from the hardened builder
only after a durable workload claim and exact Pod registration.

```
 OpenCrane control plane ── durable claim ──► agent controller
                                                            │ creates a suspended Job
                                                            ▼
                                                skill-authoring namespace
                                                zero-RBAC worker identity
                                                            │ exchanges one capability
                                                            ▼
                                                bounded validation result
```

**In this flow:** [agent controller](../agent-controller/README.md) *(sole Kubernetes mutator)* ·
[skill launcher](../../libs/backend/agents/skills/k8s-launcher/README.md) *(pure Job shape)* ·
OpenCrane *(bootstrap acknowledgement authority)*

## Public surface

- `deploy/Dockerfile` — builds an inactive one-shot worker image from immutable ClamAV and Python bases. It carries a hash-locked formatter/type/test toolchain and a read-only copied malware-signature database. It starts neither the upstream FreshClam updater nor ClamD scanner daemon.
- `src/authoring_worker.py` — private, not-yet-invoked intake, offline-validator, and terminal-completion primitives. They reject candidate dependencies and plaintext secrets, use only fixed image-owned commands, and can submit only bounded success evidence or a stable failure code to the fixed internal completion route.
- Helm chart — restricted namespace, `skill-authoring-default` ServiceAccount, quota, and default-deny policy.
- `values.yaml` — namespace, worker ServiceAccount, and quota defaults only; image, resource, and
  lifecycle values remain controller-owned.

## Boundary

The agent controller is the only Kubernetes mutator. This app exposes no listener and grants no
Kubernetes API access to the worker identity. Its default-deny namespace permits a released authoring
Pod only cluster DNS and the OpenCrane internal listener for its bootstrap acknowledgement, server-brokered
input, and terminal completion. Every endpoint TokenReviews the fixed projected-token audience and
registered Pod UID. The worker receives no ArtifactStore endpoint, credential, or signed lease; the server
selects and streams only the immutable source artifact pinned on its assigned draft revision. The server
refuses compressed candidate bundles larger than 16 MiB before it mints an ArtifactStore read lease,
and returns the pinned SHA-256 address alongside the length so the future validator can verify the
downloaded bytes. The admitted Job reserves at least 128 MiB of ephemeral `/tmp` space: 16 MiB
compressed input, 32 MiB extracted source, and validation work cannot safely share the old 64 MiB
budget. The authoring Job also reserves 3 GiB and caps at 4 GiB of memory because the pinned ClamAV
signature engine must load before it can scan. The validator code remains deliberately inactive until
a release promotes this tested image by its final digest into the controller profile. It cannot report
successful validation before that promotion.

The `container` target builds the image and proves that `clamscan`, the three fixed validator tools,
and its read-only database work without networking for UID 65532. It scans both a clean fixture and
the EICAR test signature, and proves no updater or scanner daemon is running. Image promotion also
needs the resulting final image digest in the controller profile;
the Dockerfile's source digests are not a substitute for that release digest.
The database never updates in a running Job: refresh it only by building, smoke-testing, and promoting
a new pinned image.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [tool runner](../tool-runner/README.md)
