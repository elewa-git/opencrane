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

- `deploy/Dockerfile` — builds a one-shot validation worker image from immutable ClamAV and Python bases. It carries a hash-locked formatter/type/test toolchain and a read-only copied malware-signature database. Its default entrypoint runs the bounded lifecycle, but starts neither the upstream FreshClam updater nor ClamD scanner daemon.
- `src/authoring_worker.py` — private authoring intake, offline-validator, and terminal-completion lifecycle. It rejects candidate dependencies and plaintext secrets, uses only fixed image-owned commands, and can submit only bounded success evidence or a stable failure code to the fixed internal completion route.
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
signature engine must load before it can scan. Deployment remains fail-closed even though the image
has an active default entrypoint: the controller is disabled and the authoring profile has no final
image digest. Helm refuses to enable the controller until a release promotes this tested image by its
final digest, so an unreviewed local build cannot become an executable tenant workload.

The `container` target builds the image and proves that `clamscan`, the three fixed validator tools,
and its read-only database work without networking for UID 65532. It scans both a clean fixture and
the EICAR test signature, and proves no updater or scanner daemon is running. Image promotion also
needs the resulting final image digest in the controller profile;
the Dockerfile's source digests are not a substitute for that release digest.
The database never updates in a running Job: refresh it only by building, smoke-testing, and promoting
a new pinned image.

Once a release supplies that final digest, each Job performs one closed lifecycle: it acknowledges its
server-selected workload, downloads that workload's immutable archive, extracts it below `/tmp`, runs
the four fixed offline checks, and submits either the two compact passing reports or one stable
technical failure code. The worker deletes its temporary archive and extracted files on every path.
It never sends validator output, candidate source, or file paths to the control plane.
It retries the same terminal command a small fixed number of times for a transient authority outage;
it never changes a possible success into a failure when delivery is uncertain.

## Dependency direction

An app entrypoint owns only this workload's deployment contract; it imports no libraries.

## Runtime & config

The existing `Validate and publish affected deployables` workflow builds this image whenever this
package changes on an integration branch. It publishes `ghcr.io/elewa-git/opencrane-skill-authoring`
under a commit-derived tag. The workflow does not promote it: the release operator retrieves the
manifest `sha256:` value from that published GitHub Container Registry package version and records
it in a separate values review. A tag, local image ID, or Dockerfile base digest is never a valid
substitute for that final published digest.

The controller stays disabled until one review supplies all of these: exact immutable digests for the
controller, personal runtime, authoring worker, and tool-runner worker; an exact Kubernetes API
Service CIDR; Kubernetes 1.30 or later; and an instance-local LiteLLM deployment. Only then may it
set `agentController.enabled=true`. Publishing this image alone cannot create a worker Job.

## See also

- Job builder: [skills k8s launcher](../../libs/backend/agents/skills/k8s-launcher/README.md)
- Related workload: [tool runner](../tool-runner/README.md)
