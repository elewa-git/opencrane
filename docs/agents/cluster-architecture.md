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
                  +---- LiteLLM · Obot (custody + action execution)
                  |
                  +---- agent-controller
                             |
                             +-> personal runtime Job namespace
                             +-> managed runtime Job namespace
                             +-> skill-authoring Job namespace
                             +-> tool-runner Job namespace

runtime Jobs ----> LiteLLM (attempt model key)
opencrane server ----> Obot MCP proxy (service credential, durable action fence)

artifact-service <---- brokered bytes ---- artifact-preprocessor Job namespace
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
| Personal run Job | `apps/agent-runtime` | none; one attempt |
| Managed run Job | `apps/managed-agent-runtime` | none; one scheduled or triggered attempt |
| Artifact bytes | `apps/artifact-service` | ArtifactStore behind server-issued leases |
| Document extraction | `apps/artifact-preprocessor` | none; brokered input and output |
| Skill authoring Job | `apps/skill-authoring` | none; one governed workload |
| Tool execution Job | `apps/tool-runner` | none; one governed workload |

Every independently deployed workload has one `apps/<name>` owner. Libraries under `libs/*` contain
reusable behaviour and never own a deployment.

## Namespace classes

- **Trusted server namespace** — API, controller, web, channel edge, and organisation service planes.
- **Personal runtime namespace** — one restricted Job per personal run attempt.
- **Managed runtime namespace** — one restricted Job per managed run attempt under a distinct
  service-account class.
- **Skill-authoring namespace** — candidate-skill Jobs with no standing worker.
- **Tool-runner namespace** — governed tool Jobs with no standing worker.
- **Artifact-preprocessor namespace** — bounded document-extraction Jobs with broker-only byte flow.

Each Job namespace has a restricted pod-security label, default-deny networking, bounded resource
quota, and a dedicated zero- or least-privilege service account.

## Network direction

Inbound public traffic terminates at organisation ingress. The channel proxy authenticates channel
traffic and forwards only admitted, bounded requests. Runtime Jobs open their control stream
outward; they expose no public listener.

NetworkPolicy permits only the named service path required by each workload class. Network reach is
not authorization: every sensitive server route also verifies workload identity and current durable
assignment.

Runtime model traffic reaches LiteLLM with a per-attempt virtual key. Integration actions instead
cross a durable server-owned invocation fence: the server resolves the current Obot assignment,
performs the call with its mounted service credential, stores the result, and sends only that saved
result to the runtime. Runtime Jobs receive no Obot address or credential.

The release deploys `memory-gateway` as the only NetworkPolicy-admitted path to private Cognee. Its
search-only route verifies an audience-bound server ServiceAccount token with TokenReview and also
enforces the request-shape contract (one bounded query, `CHUNKS`, exactly one UUID dataset, bounded
`top_k`). The server presents that projected `opencrane-memory-gateway` token: recall is live at
admission (fact references frozen into the snapshot) and at compile time (digest-verified statement
inlining into the prompt). Mid-run recall can use the same durable server-worker result channel as
other external actions; memory writes remain fail-closed until their recoverable write authority is
implemented and qualified.

## Storage

PostgreSQL stores durable product and audit state. ArtifactStore stores content-addressed bytes.
Cognee stores indexed organisation memory under OpenCrane-owned scope and provenance rules.

Runtime, skill, tool, and preprocessing Jobs receive only bounded scratch. Restarting or deleting a
Job cannot delete a conversation, run, artifact, skill, or organisation-memory record.

## Deployment ownership

- Each app owns its image and Helm library unit.
- `apps/_infra/deploy-k8s` composes those units into one organisation release.
- `apps/_infra/deploy-k8s/platform` owns reusable deploy and cluster-substrate helpers.
- Cluster-wide controllers remain external and are never silently installed by an organisation
  release.

See [`infra.md`](./infra.md) for build and deployment validation and [`k8s.md`](./k8s.md) for
service-account, role, route, and NetworkPolicy rules.
