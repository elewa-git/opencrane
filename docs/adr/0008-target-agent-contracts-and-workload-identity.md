# ADR 0008: Target agent contracts and workload identity

**Status:** Accepted
**Origin:** [#245](https://github.com/elewa-git/opencrane/issues/245)

## Context

OpenCrane needs one target vocabulary before schemas, APIs, policies, and runtime code can be written.
The product is still under development, so existing systems and data are not inputs to this design.
The contract must express personal and managed agents, project collaboration across organizational
structures, signed fleet membership, persona onboarding, mounted storage, and future application
updates without preserving an earlier runtime or authority model.

## Decision

### Authority and protocol

Postgres is the product authority for AgentService, AgentRevision, AgentRun, Thread, Message,
RunEvent, Approval, PersonaRevision, Artifact, SkillRevision, grants, audit, and the last verified
fleet-membership projection. Canonical bytes live behind `ArtifactStore`; durable organization
memory lives in Cognee. Runtime Pods consume immutable assignments and emit the canonical RunEvent
protocol. They do not own product state or mutate their approved persona.

Project is an authorization dimension independent of department and team. A project can include
people from several departments and teams without copying those memberships. Grant evaluation uses
numeric priority; deny wins when allow and deny have equal priority. The authorization facade fails
closed when no applicable grant exists.

The silo may trust only the highest monotonically increasing fleet-membership revision whose issuer
signature, issuer key, silo, subject, issuance time, expiry time, and membership assertions have been
verified. Cached membership remains usable only inside the configured freshness bound and never
after hard expiry. Missing, stale, mismatched, replayed, or lower revisions fail closed.

### Persona onboarding

The first personal-agent session requires a completed versioned interview. Reviewed answers select a
reviewed `SOUL.md` template and produce three to five explicit insights linked to their source
questions. The user previews the resulting PersonaRevision and approves, edits, or retakes it.
Runtime receives only the compiled approved revision; it cannot mutate durable `SOUL.md` content.

### Capability catalog

| Capability | Authority exercised | Approval checkpoint |
|---|---|---|
| `agent.service.manage` | Create, publish, suspend, or retire an AgentService | Policy-dependent |
| `agent.run.start` | Start an immutable AgentRevision in an authorized thread | No |
| `agent.run.cancel` | Fence and cancel an active run | No |
| `thread.read` | Read ordered messages and RunEvents | No |
| `thread.message.create` | Persist a user message and request a run | No |
| `artifact.read` | Resolve authorized canonical bytes through ArtifactStore | No |
| `artifact.write` | Lease, digest-verify, promote, and finalize canonical bytes | Policy-dependent |
| `artifact.delete` | Perform reference-safe authorized deletion | Yes |
| `skill.publish` | Publish an immutable SkillRevision | Yes |
| `memory.query` | Query a scoped Cognee dataset | No |
| `memory.correct` | Correct a durable memory fact with provenance | Policy-dependent |
| `memory.forget` | Delete an authorized durable memory fact and projections | Yes |
| `integration.invoke` | Invoke an Obot-custodied external integration | Action-dependent |
| `approval.decide` | Approve or deny one proof-bound action digest | No |

### Critical journeys

1. A new user completes the onboarding interview, reviews the generated PersonaRevision, and only
   then starts a first personal-agent session.
2. A cross-functional project grants the same managed agent and artifacts to members of different
   departments without changing department or team membership.
3. A user shares declared artifacts with a managed agent; the managed agent cannot read the user's
   personal threads, memory, workspace, configuration, filesystem, or logs.
4. A run pauses before a high-risk action and resumes only with a non-expired approval bound to the
   exact subject, run, revision, proof, action, and normalized arguments.
5. A silo rejects stale or replayed fleet membership while continuing to trust the last signed
   revision only within its configured freshness and hard-expiry bounds.
6. Durable storage expands online before exhaustion; future application updates remount the same
   target volumes and return ready target Pods in strictly less than five minutes.

### Application and workload identity matrix

Every row is default-deny. `none` means the workload has no Kubernetes Role and cannot mutate the
Kubernetes API. DNS and the telemetry collector are common explicitly allowed destinations and are
omitted from the network column for brevity.

| Owning app | Workload class | Kubernetes service account | Kubernetes Role | Explicit network destinations |
|---|---|---|---|---|
| `apps/opencrane` | Control API | `opencrane-api` | none | Postgres, artifact-service, memory-gateway, channel-proxy, agent-controller, Obot, LiteLLM |
| `apps/opencrane-ui` | Browser bundle | none | none | public HTTPS to opencrane only |
| `apps/channel-proxy` | Channel trust boundary | `channel-proxy` | none | opencrane, agent-runtime, managed-agent-runtime |
| `apps/agent-controller` | Sole agent-workload mutator | `agent-controller` in the server namespace | Runtime-namespace-only `get/create/patch` Jobs and `list` Pods; no other resources or verbs | Kubernetes API, opencrane |
| `apps/artifact-service` | ArtifactStore CAS API and maintenance Jobs | `artifact-service` | none | Postgres and its mounted artifact volume |
| `apps/memory-gateway` | Scoped memory API | `memory-gateway` | none | Cognee, opencrane |
| `apps/cognee-indexer` | Artifact-to-memory indexing Job | `cognee-indexer` | none | artifact-service, memory-gateway, Cognee |
| `apps/agent-runtime` | Personal agent Pods in the dedicated restricted runtime namespace | fixed projected `agent-runtime` identity | none | OpenCrane internal runtime stream only in this foundation slice |
| `apps/managed-agent-runtime` | Managed-agent Pods | per-workload projected `managed-agent-runtime` identity | none | channel-proxy, declared artifact inputs, memory-gateway, LiteLLM, Obot |
| `apps/_infra/cognee` | Durable memory engine | `cognee` | none | its mounted stores, LiteLLM |
| `apps/_infra/litellm` | Model gateway | `litellm` | none | approved model providers and its mounted store |
| `apps/_infra/obot` | Integration gateway | `obot` | none | approved external integrations and its mounted store |
| `apps/postgres` | OpenCrane CNPG database Pods | CNPG-generated `<cluster-name>` instance identity | CNPG-generated instance-manager Role only | in-silo database replication and approved backup destination |
| `apps/skill-authoring` | Skill authoring Job | `skill-authoring` | none | artifact-service, LiteLLM |
| `apps/tool-runner` | Sandboxed non-Obot tool Job | per-job projected `tool-runner` identity | none | only capability-declared destinations |
| `apps/silo-provisioner` | Fresh target-store initialization Job | `silo-provisioner` | none | target Postgres and app-owned mounted stores |

### API and Postgres ownership matrix

| Product record | API owner | Durable authority | External bytes or projections |
|---|---|---|---|
| AgentService and AgentRevision | OpenCrane agent-service module | Postgres | none |
| AgentRun and RunInputSnapshot | OpenCrane run module | Postgres | runtime receives immutable snapshot only |
| Thread, Message, and RunEvent | OpenCrane conversation module | Postgres | artifact bodies remain ArtifactStore references |
| Approval and replay state | OpenCrane authorization module | Postgres | none |
| Persona interview and PersonaRevision | OpenCrane persona module | Postgres | rendered SOUL content is compiled for runtime, never runtime-owned |
| Artifact and ArtifactRevision | OpenCrane artifact catalog module | Postgres | canonical bytes behind artifact-service ArtifactStore |
| SkillRevision | OpenCrane skill catalog module | Postgres | canonical skill bytes behind ArtifactStore |
| Grant and effective-access explanation | OpenCrane authorization module | Postgres | none |
| Verified fleet-membership projection | OpenCrane membership module | Postgres | signed source revision issued by fleet |
| Memory dataset and fact provenance | OpenCrane memory module | Postgres for catalog and audit | durable facts and derived indexes in Cognee |

Ingress, DNS, certificate, CNI, and CNPG controllers are prerequisites supplied by the cluster. They
are not OpenCrane release workloads. Terraform owns cloud trust bindings; Helm owns service accounts,
token projection, Role bindings, and default-deny Cilium policies. Default service-account token
automount is disabled, and every token has an explicit audience.

### Storage and update policy

Postgres, ArtifactStore, Cognee, and every durable dependency use explicitly mounted persistent
volumes backed by a StorageClass that supports online expansion. Capacity alerts and expansion occur
before exhaustion. Durable target data is retained indefinitely until explicit authorized deletion.

Runtime workspaces are mounted, lease-scoped, non-authoritative scratch. They are not backed up and
are cleared on Pod replacement, scale-to-zero, or lease expiry. Container root filesystems are
non-authoritative and read-only where supported.

A future application update drains or fences work, starts the one supported target image, remounts
existing durable volumes, reaches ready traffic-serving target Pods in strictly less than 300
seconds per silo, and resumes canonical state. It neither keeps a predecessor product runtime nor
transforms product data.

## Alternatives considered

- Deriving the target protocol from the existing runtime was rejected because it would make obsolete
  behavior an authority for the new product.
- Nesting projects under departments or teams was rejected because real projects are cross-functional.
- Giving runtime Pods Kubernetes mutation rights was rejected because the agent controller must be
  the sole workload-mutation boundary.
- Keeping durable user state in runtime workspaces was rejected because runtime storage is scratch,
  not an authority or backup surface.

## Consequences

- Phase D can generate target schemas, APIs, RBAC, Cilium profiles, and fresh provisioning from one
  vocabulary.
- Existing product-authority CRDs, static tokens, runtime protocols, and obsolete adapters are not
  reusable and are removed with their owning replacement slices.
- Every new workload needs a named app owner and a row in this matrix before it can land.
- Acceptance cases are recorded in
  [`personal-agent-platform-phase-c-acceptance-fixtures.json`](../design/personal-agent-platform-phase-c-acceptance-fixtures.json).
