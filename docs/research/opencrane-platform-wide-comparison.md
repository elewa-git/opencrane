# OpenCrane vs Commercial & SaaS Agent Platforms — Architecture Comparison Report

**Status:** complete — August 2026
**Scope:** Deep architectural analysis of OpenCrane compared with open-source platforms (Dify, Flowise, Langflow, n8n, CrewAI/AutoGen/LangGraph, Haystack, OpenHands, Mem0/Zep/Letta) and commercial/closed-source platforms (Claude Cowork, ChatGPT Enterprise, Microsoft Copilot Studio, Google Vertex AI Agent Builder, AWS Bedrock Agents, Salesforce Agentforce, Langdock, Buzz).
**Method:** Full repository inspection across structure, documentation, applications, libraries, manifests, infrastructure, APIs, database schema, runtime architecture, authentication/authorization, messaging/event flows, agent/AI components, frontend/backend boundaries, tests, and CI/CD — followed by comparative synthesis.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [OpenCrane architecture model](#2-opencrane-architecture-model)
3. [Platform comparison](#3-platform-comparison)
4. [What OpenCrane does particularly well](#4-what-opencrane-does-particularly-well)
5. [Architectural weaknesses and bottlenecks](#5-architectural-weaknesses-and-bottlenecks)
6. [Missing capabilities](#6-missing-capabilities)
7. [Differences from industry-leading alternatives](#7-differences-from-industry-leading-alternatives)
8. [Patterns worth adopting](#8-patterns-worth-adopting)
9. [Things that should NOT be changed](#9-things-that-should-not-be-changed)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

OpenCrane is architecturally more rigorous than every platform examined — both open-source and commercial — in identity governance, execution isolation, and release engineering. It is less mature in developer-experience accessibility, visual tooling, connector breadth, evaluation infrastructure, and memory-recall sophistication. The core thesis is that OpenCrane's "IAM-first, evidence-based, frozen-snapshot" model is a genuinely differentiated approach that no competitor replicates at this depth. However, its Kubernetes-only deployment barrier and pre-release maturity limit near-term adoption compared to hosted alternatives, while its lack of visual tooling excludes the fastest-growing segment of agent builders served by Dify, Flowise, Copilot Studio, and Bedrock Flows.

---

## 2. OpenCrane Architecture Model

### 2.1 Monorepo structure

Nx-managed TypeScript/Python monorepo (`v0.9.2`, AGPL-3.0):

| Layer | Path | Purpose |
|-------|------|---------|
| **Server API** | `apps/opencrane` | Express + Prisma control plane; owns all durable state |
| **Web client** | `apps/opencrane-ui` | Zoneless Angular 21 SPA; signals/resource state |
| **Runtime controller** | `apps/agent-controller` | Creates/releases per-attempt K8s Jobs |
| **Personal runtime** | `apps/agent-runtime` | Python + Pydantic AI; outbound SSE stream |
| **Managed runtime** | `apps/managed-agent-runtime` | Scheduled/triggered Helm-defined workload |
| **Artifact service** | `apps/artifact-service` | Content-addressed byte store |
| **Artifact scanner** | `apps/artifact-scanner` | Malware scanning in isolated namespace |
| **Artifact preprocessor** | `apps/artifact-preprocessor` | Document extraction in isolated namespace |
| **Channel proxy** | `apps/channel-proxy` | Admits external-channel traffic |
| **Memory gateway** | `apps/memory-gateway` | Only network path to Cognee |
| **Skill authoring** | `apps/skill-authoring` | Governed skill-build Job |
| **Tool runner** | `apps/tool-runner` | Governed tool-execution Job |

Shared libraries under `libs/` are organised by domain boundary:

| Domain | Libraries |
|--------|-----------|
| `libs/backend/server/iam/` | Identity, authorization, grants, groups, membership, audit |
| `libs/backend/server/gateways/` | Model routing (LiteLLM), MCP (Obot), integrations, providers |
| `libs/backend/server/conversations/` | Conversation CRUD, projection, assets |
| `libs/backend/agents/` | Execution admission, elicitation, runtime controller/k8s-launcher, skills, memory |
| `libs/backend/observability/` | Shared pino + OTEL tracing lib |
| `libs/contracts/` | Wire protocol types, validators, generated OpenAPI client |
| `libs/frontend/` | Core, elements (UI/A2UI/conversation/elicitation), features, platform, state |
| `libs/models/` | Domain model types (agents, artifacts, authorization, conversations, etc.) |

### 2.2 Database schema

PostgreSQL via Prisma with 27 domain-specific `.prisma` files under `apps/opencrane/prisma/schema/`. Key domains:

- **Conversations**: `Conversation`, `ConversationMessage`, `ConversationRunEvent`, `ConversationTimelineEntry`, `ConversationAgentThread`
- **Runs**: `AgentRun`, `RunInputSnapshot`, `WorkloadAssignment`, `WorkloadBootstrap`, `OutboxEvent`
- **IAM**: `AuthorizationGrant`, `CapabilityCatalogRevision`, `ApprovalRequest`, `ToolInvocation`, `ActionExecutionReceipt`
- **Memory**: `MemoryDataset`, `MemoryFactCatalog`, `MemoryOutboxEvent`
- **Skills**: `Skill`, `SkillRevision`, `SkillWorkload`, `SkillWorkloadBootstrap`
- **Spend**: `TokenUsageSnapshot`, `GlobalBudgetSetting`, `AccountBudgetSetting`
- **Personas**: full persona-interview-scoring-interpolation-soul-template chain
- **Artifacts**: `Artifact`, `ArtifactRevision`, `ArtifactScanJob`, `ArtifactPreprocessJob`, `ArtifactOutboxEvent`

Migrations are versioned SQL transitions under `apps/opencrane/prisma/migrations/<from>-to-<to>/`, bound by digest, with a clean target baseline.

### 2.3 Runtime execution model

Each accepted run spawns one ephemeral K8s Pod (Job) in a dedicated namespace class:

```
Browser / Channel proxy
       │
       ▼
OpenCrane Server (Express + Prisma + K8s client)
       │
       ├──▶ agent-controller ──▶ creates Job in personal-runtime or managed-runtime namespace
       │                              │
       │                              ▼
       │                    Python agent-runtime Pod
       │                    • Outbound SSE stream to controller
       │                    • Proof-key bootstrap exchange
       │                    • Projected ServiceAccount token (audience-bound)
       │                    • Pydantic AI model loop via LiteLLM virtual key
       │                    • No DB access, no master keys, no storage credentials
       │
       ├──▶ LiteLLM proxy (model routing, BYOK credential custody)
       ├──▶ Obot proxy (MCP tool invocation, integration custody)
       ├──▶ Memory gateway ──▶ Cognee (organisation knowledge)
       ├──▶ Artifact service (content-addressed bytes, lease-gated)
       └──▶ PostgreSQL (all durable state)
```

The runtime receives a **frozen RunInputSnapshot** at admission time. It cannot change permissions mid-run. Tool invocations cross a durable server-owned invocation fence: the server resolves the current Obot assignment, performs the call with its mounted service credential, stores the result, and sends only that saved result to the runtime.

### 2.4 Authentication and authorization

- Browser: OIDC session (issuer, client ID, PKCE or confidential flow); session cookie; fail-closed when unconfigured.
- Runtime Pods: Kubernetes-projected ServiceAccount tokens with exact audience strings (`opencrane-agent-runtime` vs `opencrane-managed-agent-runtime`). The two audience values never overlap.
- Authorization: evidence-based per-attempt computation from roles + grants + group memberships + frozen snapshots. No stale-session privilege escalation.
- Audit: append-only `AuditDecision` rows written in the same Prisma transaction as the state mutation.
- Roles: `_RequireOrgAdmin` gates mutations; `_RequirePlatformOperator` for cluster-level operations.

### 2.5 Messaging and event flows

No message broker (Kafka, RabbitMQ, NATS). All inter-service coordination uses:
- **HTTP REST** between services (Express routes, typed `openapi-fetch` clients).
- **SSE streams** from runtime to controller for streaming candidates/events.
- **Database outbox pattern** (`OutboxEvent`, `MemoryOutboxEvent`, `ArtifactOutboxEvent`) for reliable event propagation.
- **Kubernetes watch** for Job lifecycle events.

### 2.6 Frontend/backend boundary

Angular 21 zoneless SPA communicates exclusively through the typed REST API. No BFF layer; no server-side rendering. State management uses Angular signals and resource-based patterns (no NgRx). A2UI presentational contracts validate payloads and fail closed on malformed data. Storybook visual regression tests guard component contracts.

### 2.7 Observability

Shared `@opencrane/backend/observability` library provides:
- pino structured logging with correlation-ID context propagation
- OTEL traces exported over OTLP
- `___DoWithTrace` spans wrapping all external-I/O paths
- Secret redaction built into the logger
- Per-app `instrument.ts` entrypoint with graceful shutdown flush

### 2.8 CI/CD

GitHub Actions pipeline with:
1. **prepare** — computes Nx affected graph and deployable matrix
2. **test** — builds, tests, lints affected projects + 10 policy guards (workload ownership, agent-domain boundary, module growth, Prisma boundaries, config-docs coverage, dependency boundaries, release versioning, mechanical style, inline conditional check, affected-deployables check)
3. **database** — SQL authority suites, migration proofs, target baseline convergence
4. **api_contract** — OpenAPI + generated client sync (conditional on API changes)
5. **storybook_visual** — component visual/behaviour/a11y contracts (cached Chromium)
6. **develop_smoke** — boots disposable k3d cluster, deploys full silo, proves isolation/TLS/health
7. **image_smoke** — per-image boot checks
8. **build-and-push** — publishes SHA-pinned images on push events
9. **publish-develop-smoke-images** — completes immutable develop image set

Plus CodeQL static analysis and PR-stack integrity bookkeeping. Release manifests require dual-path proof (fresh-install AND predecessor-upgrade on same SHA).

---

## 3. Platform Comparison

The platform landscape is split into open-source and commercial/closed-source systems to make licensing, self-hostability, and governance trade-offs explicit.

### 3.1 Open-source platforms

| Dimension | **OpenCrane** | **Dify** | **Flowise** | **Langflow** | **n8n / Activepieces** | **CrewAI / AutoGen / LangGraph** | **Haystack** | **OpenHands** | **Mem0 / Zep / Letta** |
|-----------|--------------|----------|------------|-------------|----------------------|---------------------------------|--------------|--------------|---------------------|
| Category | Governed agent platform | Visual agent/workflow builder | Low-code flow canvas | Low-code graph builder | Automation with AI nodes | Code-first orchestration framework | RAG/pipeline library | Sandboxed autonomous coding agent | Memory layer specialists |
| Deployment | K8s only | Docker Compose / K8s / cloud | Docker Compose / cloud | Docker Compose / cloud | Docker Compose / K8s / cloud | Library — embed in host app | Library — embed in host app | Docker / local process | Embedded service or SDK |
| Multi-tenancy | ClusterTenant silos, per-namespace isolation | Workspace-level | Workspace-level | Project-level | Team/workflow-level | None (user-implemented) | None (user-implemented) | Single-session focus | Per-user/per-agent memory scoping |
| Identity/IAM depth | Evidence-based frozen snapshots, append-only audit, per-attempt re-binding | Workspace roles, basic RBAC | Basic RBAC | Basic RBAC | Workflow-scoped credentials | None | None | Container-scoped user | Per-memory consent and sensitivity tags |
| Execution sandboxing | Per-Job restricted namespaces, VAP digest pinning, default-deny NetworkPolicy | Shared container | Shared container | Shared container | Sandboxed code node | Host process | Host process | Sandboxed container | In-process |
| Model access | BYOK via LiteLLM proxy; multi-provider routing; attempt-scoped virtual keys | Multi-provider via API keys | Multi-provider | Multi-provider | Multi-provider | Pluggable LLM classes | Pluggable LLM classes | Multi-provider | Provider-agnostic embeddings/LLM calls |
| Tool/integration model | MCP servers via Obot custody proxy; governed tool-runner Jobs; approval-required invocation | Tool plugins + workflow nodes | Custom JS function nodes | Python/JS tool nodes | 400+ native integration nodes | LangChain/AutoGen tool ecosystem | Retriever/generator pipeline components | Shell/browser/file tools inside sandbox | Retrieval APIs only |
| Memory/knowledge | Gateway port → Cognee content + catalog provenance/consent/digest; fail-closed writes | Built-in vector store + knowledge base | Conversation buffer | Conversation buffer + vector stores | Static data / expression context | Conversation window | Vector store retrievers | Session context | Dedicated persistent memory with temporal decay/recall scoring |
| Visual workflow builder | None | Drag-drop canvas | Flow canvas | Graph canvas | Visual workflow editor | None | Pipeline YAML/Python | IDE-like coding UI | None |
| Evaluation harness | Research exists; not shipped | Basic eval framework | Manual testing | Manual testing | Expression-based assertions | Framework-level callbacks | Pipeline evaluation components | SWE-bench style benchmarks | Recall precision benchmarks |
| Observability | pino + OTEL on all external I/O; secret redaction; structured errors | Basic logs + optional Langfuse | Basic logs | Basic logs + Langfuse | Execution logs per node run | LangSmith/LangFuse callbacks | Structured logging + tracing hooks | Terminal/container logs | Latency/hit-rate metrics |
| Release engineering | Immutable manifests; dual-path qualification; advisory-lock migrations; digest-pinned VAP | Semantic versioning + Docker tags | npm semver | pip semver | Docker image tags | npm/pip semver | pip semver | Docker image tags | npm/pip semver |
| License | AGPL-3.0 | Modified Apache-2.0 | Apache-2.0 | MIT | n8n: fair-code; Activepieces: MIT | MIT | Apache-2.0 | MIT | Apache-2.0 |

**Key contrasts:**

- Dify, Flowise, and Langflow all win on visual builder accessibility but none approaches OpenCrane's execution isolation depth.
- CrewAI, AutoGen, and LangGraph are frameworks rather than products: they require the developer to build everything OpenCrane ships as a platform (IAM, audit, spend tracking, artifact scanning).
- Haystack is the closest analogue for production-grade retrieval pipelines but has no conversation, identity, or execution-isolation story.
- OpenHands is the strongest open-source comparison for sandboxed agent execution, though it focuses on coding tasks rather than general-purpose governed agents.
- Mem0, Zep, and Letta validate OpenCrane's decision to separate memory from the main application — but their memory models include temporal scoring, entity graphs, and recall ranking that OpenCrane's catalog does not yet expose.
- The automation platforms (n8n, Activepieces) demonstrate the connector-breadth gap most clearly: hundreds of first-party integrations vs OpenCrane's MCP-mediated model.

### 3.2 Commercial / closed-source platforms

| Dimension | **OpenCrane** | **Claude Cowork** | **ChatGPT Enterprise** | **Microsoft Copilot Studio** | **Google Vertex AI Agent Builder** | **AWS Bedrock Agents** | **Salesforce Agentforce** | **Langdock** | **Buzz** |
|-----------|--------------|-------------------|----------------------|----------------------------|----------------------------------|----------------------|------------------------|-------------|---------|
| Category | Governed self-hosted agent platform | Enterprise collaboration agent | Enterprise assistant platform | Low-code enterprise agent builder | Managed agent runtime + enterprise search | Cloud-native managed agents | CRM-grounded enterprise agents | Agent-building SaaS/self-host | Personal/desktop AI workspace |
| Deployment | Self-hosted K8s only | Hosted SaaS | Hosted SaaS | Azure-hosted SaaS | GCP-hosted SaaS | AWS-hosted SaaS | Salesforce-hosted SaaS | Cloud + self-hosted Docker | Desktop app |
| Multi-tenancy | ClusterTenant silos, per-namespace isolation | Team workspaces | Org/team scoping | Environment-level (dev/test/prod pipelines) | Project-level | Account-level | Org-scoped with data cloud boundaries | Workspace-level | Single-user |
| Identity/IAM depth | Evidence-based frozen snapshots, append-only audit, per-attempt re-binding | Session RBAC, admin console, audit log | Session RBAC, SSO/SCIM, admin controls | Entra ID integration, DLP policies, environment variables, connection references | Google Cloud IAM, VPC Service Controls | IAM roles + Bedrock guardrails | Salesforce permission sets + Shield audit | Basic RBAC, API-key scoped | Minimal |
| Execution sandboxing | Per-Job restricted namespaces, VAP digest pinning, default-deny NetworkPolicy | Managed sandbox (opaque) | Managed sandbox (opaque) | Power Platform hosted runtime | GKE/Cloud Run managed | Lambda/Fargate managed | Heroku/Azure managed | Shared container | Local process |
| Model access | BYOK via LiteLLM proxy; multi-provider routing; attempt-scoped virtual keys | Anthropic-only | OpenAI-only | OpenAI + Azure OpenAI | Gemini + partner models via Vertex | Amazon Nova + Anthropic/Cohere/Meta via Bedrock | Einstein LLM + OpenAI | Multi-provider via API keys | Multi-provider |
| Tool/integration model | MCP via Obot custody proxy; governed tool-runner Jobs; approval-required invocation | Built-in connectors + MCP support | Built-in connectors, GPT Actions | 1,500+ Power Platform connectors, custom connectors, plugins | Vertex extensions + Function Calling + API tools | Action groups with Lambda/API schemas + Knowledge Bases | MuleSoft/Flows/API integrations | Plugin marketplace, custom connectors | Plugin ecosystem |
| Memory/knowledge | Gateway port → Cognee content + catalog provenance/consent/digest; fail-closed writes | Claude Projects/context windows | Custom GPTs + file retrieval | Dataverse + AI Builder + knowledge sources | Vertex AI Search grounding + RAG engine | Knowledge Bases (OpenSearch/Pinecone/Aurora) | Data Cloud retrievers | Built-in vector store | Conversation buffer |
| Visual workflow builder | None | None (conversation-driven) | None (conversation-driven) | Full drag-drop topic/action editor | Agent Builder console | Bedrock Flows visual canvas | Agent Builder low-code UI | Prompt-chain builder | Visual canvas |
| Guardrails/safety | Policy-guard CI, VAP admission control, scanner/preprocessor isolation | Constitutional AI + usage policies | Moderation API + usage policies | Content moderation + DLP + sensitivity labels | Responsible AI filters + output safety | Bedrock Guardrails (denied topics, PII redaction, content filters) | Einstein Trust Layer (data masking, audit, zero-retention) | Basic prompt filtering | Not public |
| Evaluation harness | Research exists; not shipped | Not public | Not public | Topic testing + test suites | Automatic + manual evaluation metrics | Bedrock Agents built-in testing | Agent testing + monitoring dashboards | A/B testing | Not public |
| Observability | pino + OTEL on all external I/O; secret redaction; structured errors | Internal only | Internal only | Power Platform monitor + Application Insights | Cloud Logging/Tracing/Monitoring | CloudWatch + X-Ray | Event Monitoring + Shield | Basic request logs | Console output |
| Pricing model | Free/open-source (self-funded infra) | Per-seat subscription | Per-seat subscription | Per-message pack / per-user subscription | Pay-per-token + infrastructure | Pay-per-token/session | Per-conversation consumption pricing | Subscription tiers | One-time purchase/subscription |
| License | AGPL-3.0 | Proprietary | Proprietary | Proprietary | Proprietary | Proprietary | Proprietary | Core MIT, hosted proprietary | Proprietary |

**Key contrasts:**

- Microsoft Copilot Studio is the strongest commercial comparison for visual-builder UX and enterprise deployment pipelines (dev/test/prod environments with ALM), an area where OpenCrane currently has no equivalent.
- AWS Bedrock Agents validates the "managed agent runtime with guardrails as a first-class primitive" pattern that OpenCrane implements through policy guards and VAP admission — but Bedrock's approach is declarative configuration rather than OpenCrane's evidence-frozen snapshots.
- Salesforce Agentforce demonstrates how a platform can ground agents in domain-specific data boundaries (Data Cloud, zero-retention, field-level security) — relevant to OpenCrane's memory-consent design.
- Google Vertex AI Agent Builder offers the closest commercial parallel to OpenCrane's RAG-grounding architecture, though its grounding is search-index-driven rather than consent-gated fact-catalog-driven.
- Claude Cowork and ChatGPT Enterprise remain the strongest consumer-experience benchmarks for conversation quality and multimodal input, both areas where OpenCrane lags significantly.
- Buzz represents the personal/local-agent category: minimal governance, no multi-tenancy, no audit trail — useful mainly to illustrate what OpenCrane explicitly rejects in favour of enterprise rigor.

---

## 4. What OpenCrane Does Particularly Well

### 4.1 Identity-first trust architecture (unique among all peers)

No commercial or open-source platform implements evidence-based per-attempt authorization with frozen snapshots. ChatGPT Enterprise and Claude Cowork use session-token RBAC — once authenticated, the session grants broad access until expiry. OpenCrane binds each action to independently verifiable evidence at admission time and freezes that snapshot, so a revoked user's already-admitted job cannot escalate privileges beyond what was authorised at start.

**Evidence:** `docs/agents/architecture.md`; `libs/backend/server/iam/authorization/main/src/effective-access.ts`; `libs/contracts/src/run-input-snapshot.types.ts`.

### 4.2 Kubernetes-native sandboxing exceeds every competitor

Per-Job restricted namespaces with default-deny NetworkPolicy, ValidatingAdmissionPolicy digest pinning, and zero-privilege service accounts represent enterprise-grade isolation that no library framework or even Dify provides out of the box. Commercial platforms use opaque managed sandboxes whose isolation guarantees cannot be audited by the customer.

**Evidence:** `docs/agents/cluster-architecture.md`; separate namespace classes for personal/managed/skill/tool/preprocess/scan jobs; `apps/_infra/deploy-k8s/platform/tests/platform-network-policy-contract.sh`.

### 4.3 Memory governance boundary

Separating durable fact content (Cognee) from metadata catalog through a single gateway port prevents both direct-call sprawl and uncontrolled data exposure. Every read and write goes through the gateway port; Cognee holds content while OpenCrane's catalog holds metadata/provenance/consent/digest. Fail-closed writes prevent silent data loss.

**Evidence:** `libs/backend/server/infra/memory-gateway-client/`; `libs/backend/server/infra/memory-gateway-client/src/cognee-http.ts`; `AGENTS.md` memory-engineer description.

### 4.4 Release engineering maturity rivals commercial platforms

Immutable release manifests requiring dual-path qualification (fresh-install AND predecessor-to-candidate on the same immutable SHA) exceed most open-source projects and match commercial internal standards. Advisory-lock migrations with automatic rollback, digest-pinned VAP, and CI-enforced version-mirror consistency are production-grade practices rarely seen in pre-1.0 projects.

**Evidence:** `releases/release-manifest.schema.json`; `docs/agents/versioning.md`; `docs/ci-and-deploy.md`.

### 4.5 Observability is first-class, not bolted on

A shared observability library with mandatory trace-span wrapping of external I/O, secret redaction, structured error nesting, and per-app instrument/shutdown-flush entrypoints ensures fleet-consistent telemetry without per-team drift.

**Evidence:** `libs/backend/observability/src/index.ts`; per-app `instrument.ts` files; `___DoWithTrace` usage throughout gateways.

### 4.6 BYO-model portability avoids vendor lock-in

LiteLLM proxy with attempt-scoped virtual keys means organisations can switch providers without rebuilding the assistant product. This contrasts sharply with ChatGPT Enterprise (OpenAI-only) and Claude Cowork (Anthropic-only).

**Evidence:** `libs/backend/server/gateways/model-routing/main/src/core/litellm-model-inventory.ts`; `provision-byok-key.ts`; `apps/_infra/litellm/`.

### 4.7 Comprehensive policy-guard CI

Ten automated policy guards (workload ownership, agent-domain boundaries, module-growth detection, Prisma boundary enforcement, config-docs coverage, dependency boundaries, release-versioning, mechanical style, inline-conditionals, affected-deployables) enforce architectural constraints mechanically rather than relying on review discipline alone.

**Evidence:** `package.json` scripts section; `scripts/` directory; `docs/ci-and-deploy.md` job table.

---

## 5. Architectural Weaknesses and Bottlenecks

### 5.1 Kubernetes-only deployment excludes non-cluster teams

No Docker Compose fallback, no VM deployment path, no serverless mode. Teams without cluster expertise default to Dify or Langflow which run on a laptop. ChatGPT Enterprise and Langdock eliminate this entirely by being hosted or trivially deployable.

**Evidence:** `apps/_infra/deploy-k8s/` requires CNPG CRDs, cert-manager, ingress-nginx; no alternative deployment path documented anywhere.

**Severity:** High — this is the single largest adoption barrier.

### 5.2 No visual workflow builder or low-code surface

ChatGPT Enterprise offers conversation-driven GPT creation; Claude Cowork offers project-scoped assistants; Dify and Langflow offer drag-drop canvases. OpenCrane requires understanding the API, database schema, and Kubernetes topology to define agents and workflows. This limits adoption to engineering-led organisations.

**Evidence:** `apps/opencrane-ui` contains only login and app-shell pages; all agent/workflow definition happens through the API.

**Severity:** High for non-technical adopters; medium for engineering-led teams.

### 5.3 Database outbox pattern lacks a consumer dispatcher

Multiple `OutboxEvent` tables exist (`runs.prisma`, `memory.prisma`, `artifacts.prisma`) but no background dispatcher processes them into downstream notifications or webhooks. Events accumulate unless manually consumed. Commercial platforms provide real-time webhook/event-stream delivery.

**Evidence:** Prisma schema defines `OutboxEvent` models; search finds writers but no scheduled consumer/dispatcher service.

**Severity:** Medium — blocks integration scenarios where external systems need to react to OpenCrane events.

### 5.4 Single PostgreSQL instance is both control plane and event bus

All durable state, audit trails, conversation history, run events, and outbox records live in one PostgreSQL database. At scale, this creates contention between OLTP reads/writes and append-heavy event/audit writes. Commercial platforms typically separate analytics/event storage from transactional state.

**Evidence:** `apps/opencrane/prisma/schema/` — all models in one datasource; no read-replica configuration; no time-series partitioning.

**Severity:** Medium — manageable at current scale but will bottleneck at thousands of concurrent users.

### 5.5 Memory recall stops at safe-delivery checkpoint

The memory-recall tool currently halts at `safe_delivery_required` before calling Cognee. The recoverable write path is not yet implemented (#601 pending). This means personal-memory recall is architecturally designed but not yet functional end-to-end.

**Evidence:** `docs/agents/cluster-architecture.md` — "currently stops at safe_delivery_required"; issue #601 referenced.

**Severity:** High functionally (missing capability); low architecturally (design is sound).

### 5.6 No evaluation or testing harness for agent quality

Design research exists (`litellm-router-autonomous-improvement-research.md`) but there is no shipped capability for measuring agent output quality, regression-testing prompts, or A/B testing model choices. LangSmith, Dify's eval framework, and ChatGPT's implicit feedback loops provide this.

**Evidence:** No evaluation-related code found in `libs/` or `apps/`; research doc acknowledges the gap.

**Severity:** Medium-high for production readiness.

### 5.7 AGPL license deters commercial adoption

Apache-2.0/MIT competitors (Langflow, Langchain, Langdock) face no friction for enterprise embedding. AGPL requires source disclosure for network use, which many enterprises refuse. Dual licensing or a more permissive core would widen adoption.

**Evidence:** `package.json` `"license": "AGPL-3.0-or-later"`.

**Severity:** High for commercial traction; not an architectural concern.

### 5.8 Smaller community/ecosystem

LangChain has thousands of integrations and hundreds of contributors. Dify has hundreds of plugins. OpenCrane has no plugin marketplace, no community-contributed connectors, and a small contributor base. This is a compounding disadvantage: fewer users → fewer contributions → fewer integrations → fewer users.

**Evidence:** Repository commit history; absence of a plugin/connector registry beyond MCP server definitions.

**Severity:** High long-term.

---

## 6. Missing Capabilities

| Capability | Present in | Status in OpenCrane |
|------------|-----------|-------------------|
| Visual workflow builder | Dify, Langflow, FlowiseAI | Absent |
| Real-time webhook/event dispatch | ChatGPT, Zapier, n8n | Outbox tables exist; no dispatcher |
| Evaluation/regression harness | LangSmith, Dify, Braintrust | Research exists; not implemented |
| Plugin/marketplace ecosystem | ChatGPT GPT Store, Dify plugins | MCP catalogue exists; no user-facing marketplace |
| Multi-modal input (images/audio) | ChatGPT, Claude, Gemini | Text-only conversation model currently |
| Collaborative editing / shared canvases | Claude Cowork projects, Notion AI | Single-user conversation threads |
| Scheduled agent runs with cron-like triggers | Managed agents exist but limited trigger variety | `AgentServiceSchedule` model exists; implementation scope unclear |
| Human-in-the-loop approval chains with delegation | Claude Cowork admin approvals | `ApprovalRequest` + deferred-tool-approval lifecycle exists; delegation unclear |
| Usage analytics dashboards | ChatGPT Enterprise admin, Langfuse | `TokenUsageSnapshot` + `spend.prisma` exist; no dashboard UI |
| Self-hosted evaluation datasets | LangSmith datasets, Braintrust | Absent |
| Fine-grained cost attribution per user/agent/project | ChatGPT Enterprise reporting | Budget settings exist; per-run cost attribution unclear |
| Mobile application or PWA | ChatGPT mobile app, Claude mobile | Responsive web only |
| Offline/local model support | Ollama, llama.cpp integrations elsewhere | LiteLLM can route to local endpoints; not documented/promoted |
| Data export/compliance tooling | ChatGPT Enterprise data export | No export mechanism found |

---

## 7. Differences From Industry-Leading Alternatives

### 7.1 Governance philosophy: evidence-based vs session-based

ChatGPT Enterprise and Claude Cowork grant broad capabilities after initial authentication. OpenCrane re-verifies identity, grants, and scope for each attempt and freezes them. This makes OpenCrane fundamentally more secure for high-trust environments but also harder to configure and understand.

### 7.2 Execution model: ephemeral Jobs vs persistent sessions

Commercial platforms maintain persistent conversation contexts within a managed sandbox. OpenCrane spins up a fresh Pod per attempt with no durable state. This is more secure and reproducible but adds cold-start latency (~seconds for Pod scheduling) versus milliseconds for a warm sandbox.

### 7.3 Tool invocation: server-mediated custody vs direct calls

In ChatGPT/Claude, tools execute inside the platform sandbox. In OpenCrane, the server mediates every MCP call through Obot, storing results before forwarding to the runtime. This prevents the runtime from ever holding integration credentials but adds a round trip.

### 7.4 Model access: BYOK multi-provider vs platform-locked

ChatGPT Enterprise is OpenAI-only. Claude Cowork is Anthropic-only. OpenCrane supports any provider LiteLLM supports via BYOK keys stored as K8s Secrets. This is a significant advantage for organisations wanting to avoid vendor lock-in or optimise cost across models.

### 7.5 Knowledge/memory: governed gateway vs embedded retrieval

ChatGPT and Claude embed retrieval directly into their platforms. OpenCrane separates retrieval (Cognee) from the control plane through a gateway with explicit consent, provenance, and sensitivity metadata. This gives organisations audit-grade control over what agents know but adds complexity.

### 7.6 Deployment complexity: single-binary/container vs full cluster

Langdock ships a Docker Compose file. Dify ships Docker Compose. ChatGPT is fully managed. OpenCrane requires a Kubernetes cluster with CNPG, ingress-nginx, cert-manager, and multiple namespaces. This reflects its security-first design but dramatically raises the minimum viable deployment.

---

## 8. Patterns and Technologies Worth Adopting

| Pattern/Technology | Source | Benefit for OpenCrane |
|--------------------|--------|----------------------|
| Event dispatcher/outbox consumer | Standard microservices pattern | Activate existing `OutboxEvent` tables; enable webhook delivery |
| Read-replica PostgreSQL | Standard scaling pattern | Separate analytics/audit queries from OLTP |
| gRPC or WebSocket bidirectional streaming | Modern agent frameworks | Lower latency than SSE for runtime-controller communication |
| Time-partitioned audit tables | Compliance-focused databases | Prevent unbounded audit growth; enable retention policies |
| Circuit breaker on gateway clients | Resilience patterns (Hystrix/polly) | Graceful degradation when Cognee/LiteLLM/Obot unavailable |
| Policy-as-code linting (OPA/Rego) | Cloud-native governance | Validate authorisation configurations before deployment |
| Structured evaluation framework (promptfoo/Ragas style) | LLM quality assurance | Enable regression testing of agent outputs |
| Docker Compose development profile | Dify/Langdock approach | Reduce contributor onboarding friction |
| Webhook subscription model | Zapier/n8n/Make | Let external systems react to OpenCrane events |
| Multi-modal input pipeline | ChatGPT/Gemini/Claude | Extend beyond text-only conversations |
| Plugin SDK/manifest format | ChatGPT plugin spec, Dify plugins | Enable community-contributed integrations |
| Cost attribution tags per run | FinOps practice | Per-user/per-agent/per-project cost visibility |

---

## 9. Things That Should NOT Be Changed

These are architectural decisions that differentiate OpenCrane and would be weakened by "simplification" toward commercial-platform norms:

1. **Frozen RunInputSnapshot per attempt.** Do not replace with live permission lookups during execution. The immutability guarantee prevents mid-run escalation and enables deterministic replay for debugging.

2. **Server-mediated Obot/MCP custody.** Do not give runtimes direct MCP server addresses or credentials. The current fence pattern is the strongest security property of the tool-invocation path.

3. **Separate namespace-per-job-class with default-deny networking.** Do not collapse into a single namespace or shared pod for simplicity. The blast-radius containment is essential for multi-tenant trust.

4. **Gateway-port pattern for memory access.** Do not allow direct Cognee calls from scattered call sites. The single-port rule enforces provenance, consent, and sensitivity tracking.

5. **Dual-path release qualification (fresh-install + predecessor upgrade).** Do not reduce to a single-path proof. Real-world upgrades break in ways fresh installs do not reveal.

6. **Append-only audit in the same Prisma transaction.** Do not move audit to a fire-and-forget side effect. Transactional coupling ensures audit completeness.

7. **Distinct audience strings for personal vs managed runtime tokens.** Do not unify them. The non-overlapping prefixes prevent a personal runtime from borrowing managed-agent network reach.

8. **BYOK key storage in K8s Secrets (never in database).** Do not move provider keys to PostgreSQL rows even if encrypted. The K8s RBAC boundary around Secrets provides defence-in-depth.

9. **Nx affected-graph CI with ten policy guards.** Do not simplify to "build everything." The guards catch architectural violations mechanically and scale better than review-based enforcement.

10. **AGPL license (unless strategic decision changes it).** The license aligns with the project's mission of keeping organisational AI under organisational control.

---

## 10. Recommendations

| Priority | Recommendation | Horizon | Effort | Impact |
|----------|---------------|---------|--------|--------|
| P0 | Implement memory-recall content-delivery path (#601) to close safe_delivery_required gap | Short term | Medium | Unblocks personal-assistant memory feature end-to-end |
| P0 | Implement outbox-event dispatcher that delivers webhooks to subscribed endpoints | Short term | Low-Medium | Enables external-system integration; activates dormant tables |
| P0 | Ship structured evaluation harness (prompt regression testing, golden-output comparison, model A/B scoring) | Medium term | High | Enables confidence in agent quality before production deployment; matches LangSmith/Dify capability |
| P0 | Offer managed/hosted tier (or partner-hosted) alongside self-hosted K8s | Long term | Very High | Addresses largest market-segment gap vs ChatGPT Enterprise/Claude Cowork |
| P1 | Publish Docker Compose development profile (vanilla PostgreSQL + PgBouncer, no CNPG operator) for local iteration | Short term | Low | Reduces contributor onboarding friction significantly |
| P1 | Add per-run cost-attribution fields (user ID, agent ID, model, token count, estimated cost) to TokenUsageSnapshot | Short term | Low | Enables cost visibility needed for budget enforcement and enterprise reporting |
| P1 | Build minimal visual workflow builder (start with prompt-chain composition, expand to tool wiring) | Medium term | Very High | Removes largest adoption barrier for non-engineering teams |
| P1 | Implement circuit-breaker pattern on gateway clients (Cognee, LiteLLM, Obot) with health-check surfacing to readiness probes | Medium term | Medium | Improves resilience; prevents cascading failures |
| P1 | Add read-replica PostgreSQL configuration with query-routing for audit/analytics paths | Medium term | Medium | Prepares for scale beyond hundreds of concurrent users |
| P1 | Consider dual licensing (AGPL core + commercial license for enterprise embedding) | Long term | Strategic decision | Removes AGPL friction for enterprise adoption while preserving open-source mission |
| P1 | Implement collaborative workspaces (shared agent configurations, team-level skills, organisation-wide knowledge sources with granular permissions) | Long term | Very High | Matches Claude Cowork project-scoped collaboration and ChatGPT Team shared-GPT capability |
| P2 | Create reference authorisation-policy examples with interactive documentation | Short term | Low | Mitigates IAM-complexity adoption risk identified in the previous report |
| P2 | Evaluate Mem0 or Zep temporal-scoring and entity-graph recall patterns for incorporation into MemoryFactCatalog schema | Short term | Medium (research) | Informs medium-term memory-quality improvements without changing gateway boundary |
| P2 | Implement multi-modal input pipeline (image attachments in conversations, vision-model routing) | Medium term | High | Matches baseline expectations set by ChatGPT/Claude/Gemini |
| P2 | Add time-partitioned audit tables with configurable retention and archival to object storage | Medium term | Medium | Prevents unbounded audit growth; supports compliance requirements |
| P2 | Publish plugin SDK/manifest specification for community-contributed MCP servers and tools | Medium term | Medium | Starts ecosystem flywheel; reduces bus-factor risk |
| P2 | Study n8n connector-node abstraction to design typed integration manifest format for OpenCrane MCP tools | Medium term | Medium | Prepares for broader ecosystem contribution without coupling to a specific integration framework |
| P2 | Evaluate gRPC or WebSocket bidirectional streaming for runtime↔controller communication if SSE latency becomes measurable at scale | Long term | Medium | Future-proofs communication layer |
| P2 | Explore WebAssembly-based sandboxing (WasmEdge/Wasmtime) as lighter-weight alternative to full K8s Pods for short-lived tool executions | Long term | High (research) | Could reduce cold-start latency for simple tool calls while maintaining isolation |
| P3 | Build connector marketplace with revenue-sharing for third-party integration authors | Long term | Very High | Long-term ecosystem sustainability; matches Salesforce AppExchange / Slack App Directory model |
