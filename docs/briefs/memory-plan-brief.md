# Brief: Cognee Evaluation for OpenCrane Memory Layer

## Purpose

This brief consolidates findings from a review of `memory-review.md` in the `elewa-git/opencrane` repository, plus follow-up research on Cognee's ingestion model, multi-tenancy, and security. It is intended as input to an implementation plan that builds on top of the existing `plan.md`.

## Background

OpenCrane currently uses PostgreSQL-backed document storage with metadata-driven retrieval for tenant-scoped knowledge. The open architectural decision is whether to keep evolving this stack directly or adopt a memory orchestration layer such as Cognee. OpenClaw — the agent layer sitting in front — already has SharePoint access via existing tool integrations.

## Key Findings

### 1. Cognee's ingestion model is format-centric, not source-system-centric

Cognee's `add` operation ingests files, directories, raw text, URLs, or S3 URIs, and supports 38+ formats (PDF, CSV, JSON, audio, images, code, etc.). It does not ship first-class connectors for SharePoint or Google Workspace. The "30+ supported sources" language in marketing materials refers primarily to formats and storage primitives, plus a roadmap of new connectors.

In practice, source-system integration (auth, traversal, delta sync, permission mapping) sits upstream of Cognee. Cognee handles everything after the bytes arrive.

### 2. The OpenClaw-feeds-Cognee pattern is a clean architectural fit

Because OpenClaw already accesses personally owned data sources such as SharePoint/Google Workspace/ERP system/..., the ingestion gap largely disappears. The target pattern is write-through memory: SharePoint/Workspace/Odoo/... remains the system of record; OpenClaw reads on-demand; relevant findings are persisted into Cognee so subsequent agent invocations for the same tenant/user/topic don't re-fetch and re-reason from raw source content.

Three plausible mechanisms, increasing in determinism:

- **Tool-driven**: expose Cognee's MCP server alongside SharePoint tools; instruct the agent via prompt to persist findings. Lightweight, reversible, but non-deterministic.
- **Wrapper-driven**: middleware on OpenClaw's SharePoint tool auto-persists every successful read to Cognee. Deterministic but dilutes memory and shifts permission propagation to the wrapper.
- **Tiered (recommended)**: cheap auto-ingest of metadata + summary on every read (deterministic recall) plus an explicit "remember this" tool the agent calls for high-value findings (model-driven precision).

#### Agent Training
OpenClaw's living within OpenCrane must be informeb about and trained on their memory sources and their expectations to contribute to the memory lake.


### 3. Cognee is multi-tenant by design (not single-tenant)

Cognee ships a multi-user permission system, enabled via `EBAC` (Enable Backend Access Control). Key properties:

- **Unit of permission**: the *dataset* — a self-contained bundle of documents plus their graph and vector representations. Permissions are defined at the dataset level; there is no per-document permission inside a dataset. Datasets map well on any logical document structures within OpenCrane (Org-level, Department-level, Team-level, project-levelm ...)
- **Principal types**: Users, Tenants, and Roles. Tenants are first-class objects in the model.
- **Operations**: Read, Write, Share, Delete.
- **Permission evaluation**: effective permissions are computed on demand by combining direct user grants, role membership, and tenant membership. Revocations take effect immediately. Permissions can be controlled from the OpenCrane dashboard.
- **Storage isolation**: on embedded backends (LanceDB, Kuzu), EBAC enforces per-user and per-dataset filesystem layout, providing physical isolation in addition to ACL filtering.

These RBAC features are already available in self-hosted Cognee; audit logging and multi-user workspaces are on the cloud roadmap. Cognee will be deployed within our cluster so self-hosted.

### 4. Answer to design questions for OpenCrane

These need to be answered in the implementation plan:

- **Dataset granularity**: is a dataset `= tenant`, `= (tenant, source-system)`, `= (tenant, project)`, or finer? A SharePoint doc shared only with finance and a tenant-wide doc cannot coexist in the same dataset without sub-dataset filtering in OpenClaw, because Cognee will return both on a Read query.

-> ANSWER: Datasets are personal, project-wide, team-wide, . All tenants have access to org-wide info.  Each tenant further has a personal cognee. Finally, Tenants are bound to projects, team and department datasets from the opencrane-api.

- **AccessPolicy mapping**: how does OpenCrane's existing AccessPolicy model map onto Cognee's Users/Tenants/Roles + Read/Write/Share/Delete? This is a real piece of work but bounded.

-> ANSWER: The control plane manages which tenants ahve access to which projects & department datasts.

- **Source-permission propagation**: SharePoint ACLs must either be encoded as smaller datasets (cleaner, more proliferation) or enforced sub-dataset by OpenClaw before returning results to the user.

-> ANSWER: Files are copied into Cognee datasets based on user/claw initiation. User action controls which data is moved where.

- **Freshness/invalidation**: stale memory in Cognee is a real risk. Recommended: store the SharePoint document ETag/version alongside the memory entry, re-fetch if older than N days on retrieval.

-> ANSWER: Yes, refetch certain docs when user who added them queries them, if older than 1 day, or if user asks, or if edited due to user claw action. 

- **Audit completeness on self-hosted**: must be verified — the announced audit logging is part of the cloud workspace package; self-hosted parity is not confirmed.

-> ANSWER: We'll follow their self-hosted roadmap. Not required but nice-to-have.

## How This Changes the Original Review's Recommendation

The original `memory-review.md` listed "uncertain fit for strict tenancy boundaries" as a Cognee con. That con should be retired in its current form. Tenancy is built into Cognee's model. The remaining work is:

1. Mapping OpenCrane's AccessPolicy semantics onto Cognee's principal model.
2. Choosing dataset granularity.
3. Verifying audit log completeness on self-hosted.

The "Cognee saves us custom code" pro should also be tightened: it saves orchestration/retrieval code, not source-system connector code. With OpenClaw already owning SharePoint access, this is fine — the work it saves is the work OpenCrane actually wants to avoid.

## Proposed Architecture (for the implementation plan to elaborate)

```
Org Sources (SoR)  ──read──>  OpenClaw  ──tool call──>  Cognee
(SharePoint,             (agent +                  (write-through memory,
 Workspace, ERP,         source tools +            per-dataset isolation,
 docs, ticketing, ...)   Cognee MCP)               tenant-scoped principal)
                                             │
                                             └──retrieval──>  Cognee (Read)
                                                                        │
                                                                        ▼
                                                                     Response to user
                                                                     (with OpenClaw enforcing
                                                                      sub-dataset filtering if
                                                                      dataset granularity is coarse)
```

Connector notes:
- OpenClaw remains the connector layer for source-specific auth, traversal, delta sync, and ACL extraction.
- Cognee remains the memory orchestration layer after bytes and metadata arrive.
- Retrieval responses preserve source ACL semantics through dataset placement and OpenClaw filtering.

## Recommended Updates to the Adoption Gate

Original gate: strict tenant isolation, AccessPolicy compatibility, observable performance, operational simplicity.

Proposed additions:

- Dataset granularity decision documented.
- AccessPolicy → Cognee (User/Tenant/Role + Read/Write/Share/Delete) mapping designed.
- Audit log completeness verified on the self-hosted version OpenCrane would actually run.
- Freshness/invalidation strategy defined (ETag-or-version-based recommended).
- Write-through pattern chosen (tool-driven, wrapper-driven, or tiered).

## Recommended PoC Scope

A focused proof-of-concept comparing Cognee vs pgvector-native vs LangChain/LlamaIndex orchestration should include:

- A single tenant with two users having different SharePoint ACL profiles.
- A document set covering tenant-wide, group-restricted, and user-restricted access.
- Test cases for: cross-tenant isolation, sub-tenant permission enforcement, stale-content invalidation, audit trace completeness.
- Measured: retrieval latency, ingestion cost, code-volume delta vs current Postgres-only path.

## Sources

- [elewa-git/opencrane — memory-review.md](https://github.com/elewa-git/opencrane/blob/main/memory-review.md)
- [Cognee Documentation — Permissions System Overview](https://docs.cognee.ai/core-concepts/multi-user-mode/permissions-system/overview)
- [Cognee Documentation — Permissions & Security](https://docs.cognee.ai/cognee-cloud/permissions-security)
- [Cognee Documentation — Core Concepts Overview](https://docs.cognee.ai/core-concepts/overview)
- [Cognee Blog — Multi-Tenant Ready: RBAC, Dataset Sharing](https://www.cognee.ai/blog/cognee-news/product-announcement-user-management)
- [Cognee Blog — June 2025 Updates](https://www.cognee.ai/blog/cognee-news/cognee-june-updates)
- [Cognee GitHub — topoteretes/cognee](https://github.com/topoteretes/cognee)
- [Cognee on PyPI](https://pypi.org/project/cognee/)
- [From RAG to Graphs: How Cognee Builds AI Memory (Memgraph)](https://memgraph.com/blog/from-rag-to-graphs-cognee-ai-memory)
- [Hindsight vs Cognee: AI Agent Memory Comparison (2026)](https://vectorize.io/articles/hindsight-vs-cognee)
