# Cluster architecture

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

This page is the contributor view of workloads, namespaces, and ownership. The public illustrated
overview lives at [opencrane.ai/advanced/architecture](https://opencrane.ai/advanced/architecture).

## Organisation silo

A **ClusterTenant** represents one customer organisation. Its installation owns one trusted server
namespace plus separate namespaces for untrusted or narrowly trusted Job classes. Organisation data
and credentials are not shared across ClusterTenant boundaries.

```text
organisation ingress
        |
        +-> opencrane-ui
        +-> channel-proxy
        +-> opencrane server ---- PostgreSQL
                  |
                  +---- memory-gateway ---- Cognee (sealed foundation)
                  +---- LiteLLM
                  |
                  +---- agent-controller
                             |
                             +-> personal warm runtime namespace
                             +-> managed warm runtime namespace
                             +-> skill-authoring Job namespace

claimed runtime Pods ----> LiteLLM (attempt model key)
opencrane server ----> OCI MCP executor Jobs (durable claim + Pod-bound companion)

artifact-service <---- brokered bytes ---- artifact-preprocessor Job namespace
        ^
        +-------- quarantined bytes ---- artifact-scanner namespace
                                           |
                                  clean / rejected result
```

The `apps/_infra/deploy-k8s` umbrella chart composes the app-owned Helm units for one organisation.
Cluster-wide ingress, certificate, DNS, and CloudNativePG controllers are external prerequisites.

## Workload ownership

| Workload | Owner | Durable authority |
| --- | --- | --- |
| OpenCrane API | `apps/opencrane` | PostgreSQL product records |
| Web client | `apps/opencrane-ui` | none; authenticated API client |
| Channel edge | `apps/channel-proxy` | none; admitted context only |
| Memory gateway | `apps/memory-gateway` | none; authenticated read-only Cognee boundary |
| Runtime controller | `apps/agent-controller` | database-fenced assignment claims |
| OCI MCP executor companion | `apps/mcp-executor` | one durable discovery or tool-call command |
| Personal warm runtime | `apps/agent-runtime` | one-use Absurd claim for one attempt |
| Managed warm runtime | `apps/agent-runtime` | one-use Absurd claim for one scheduled or triggered attempt |
| Artifact bytes | `apps/artifact-service` | ArtifactStore behind server-issued leases |
| Document extraction | `apps/artifact-preprocessor` | none; brokered input and output |
| Malware scanning | `apps/artifact-scanner` | none; brokered quarantined bytes and fenced result only |
| Skill authoring Job | `apps/skill-authoring` | none; one governed workload |

Every independently deployed workload has one `apps/<name>` owner. Libraries under `libs/*` contain
reusable behaviour and never own a deployment.

## Namespace classes

- **Trusted server namespace** — API, controller, web, channel edge, and organisation service planes.
- **Personal runtime namespace** — one fixed warm Deployment whose Pods are claimed once for personal runs.
- **Managed runtime namespace** — one fixed warm Deployment whose Pods are claimed once for managed runs.
- **OCI MCP executor namespace** — one restricted two-container Job per immutable MCP image
  discovery or tool call. The uploaded image receives no OpenCrane token; the fixed companion gets
  a short-lived Pod-bound token and reports one checked result.
- **Skill-authoring namespace** — candidate-skill Jobs with no standing worker.
- **Tool-runner namespace** — governed tool Jobs with no standing worker.
- **Artifact-preprocessor namespace** — bounded document-extraction Jobs with broker-only byte flow.
- **Artifact-scanner namespace** — an outbound-only scanner Deployment with broker-only quarantined
  byte flow, pinned offline definitions, and no database or ArtifactStore authority.

Each workload namespace has a restricted pod-security label, default-deny networking, bounded
resource quota, and a dedicated zero- or least-privilege service account.

## Network direction

Inbound public traffic terminates at organisation ingress. The channel proxy authenticates channel
traffic and forwards only admitted, bounded requests. Claimed warm runtimes open their control stream
outward; they expose no public listener.

NetworkPolicy permits only the named service path required by each workload class. Network reach is
not authorization: every sensitive server route also verifies workload identity and current durable
assignment.

Runtime model traffic reaches LiteLLM with a per-attempt virtual key. MCP discovery and tool calls
instead cross a durable server-owned invocation fence: the server freezes an admitted OCI image
digest, assigns the command to a class-specific executor Job, stores the checked result, and sends
only that saved result to the runtime. Runtime Pods receive no registry credential or Kubernetes
mutation authority.

Uploaded and generated conversation files remain hidden while quarantined. The scanner authenticates
to the private server route with its dedicated projected ServiceAccount token. The server rechecks
the live claim fence and streams exact bytes through its own ArtifactStore lease; it never gives the
scanner a storage address, signing key, or database credential. Only a clean result publishes the
revision and moves the conversation asset to Ready. Rejection or a terminal scan failure moves it to
Failed. When the scanner capability is disabled, public and runtime upload admission fails closed so
no file can remain indefinitely in Processing.

The release deploys `memory-gateway` as the only NetworkPolicy-admitted path to private Cognee. Its
search-only route verifies an audience-bound server ServiceAccount token with TokenReview and also
enforces the request-shape contract (one bounded query, `CHUNKS`, exactly one UUID dataset, bounded
`top_k`). Admission freezes only the verified dataset coordinates. The model chooses a query through
the approval-required `memory_recall` tool, which currently stops at `safe_delivery_required` before
Cognee is called. #601 must add a transient, claim-fenced content-delivery path; memory writes remain
fail-closed until their recoverable write authority is implemented and qualified.

## Storage

PostgreSQL stores durable product and audit state. ArtifactStore stores content-addressed bytes.
Cognee stores indexed organisation memory under OpenCrane-owned scope and provenance rules.

Runtime Pods and skill, tool, and preprocessing Jobs receive only bounded scratch. Restarting or
deleting a workload cannot delete a conversation, run, artifact, skill, or organisation-memory record.

## Deployment ownership

- Each app owns its image and Helm library unit.
- `apps/_infra/deploy-k8s` composes those units into one organisation release.
- `apps/_infra/deploy-k8s/platform` owns reusable deploy and cluster-substrate helpers.
- Cluster-wide controllers remain external and are never silently installed by an organisation
  release.

See [`infra.md`](./infra.md) for build and deployment validation and [`k8s.md`](./k8s.md) for
service-account, role, route, and NetworkPolicy rules.
