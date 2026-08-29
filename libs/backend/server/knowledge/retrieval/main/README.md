# @opencrane/backend/server/knowledge/retrieval — org retrieval sources & dataset scope

> [backend](../../../../README.md) › [server](../../../README.md) › [knowledge](../../README.md) › retrieval

## What it owns

This package is part of **Knowledge** — what an organisation's agents can retrieve from its shared
memory. That memory lives in **Cognee**, the external service OpenCrane runs to ingest an org's
documents and answer similarity searches over them. This package owns two things at the front of
that read path: the **registry of where org content comes from** (the third-party sources — Slack,
Confluence, git repositories, the Model Context Protocol (agent tool-connection standard) registry, skill bundles — and the
inventory of items discovered in each), and the **canonical dataset-scope ordering** every reader
and authorization check shares.

A **dataset scope** is how broad a slice of org memory a query may see. The scopes run from
narrowest to broadest — Personal, Project, Team, Department, Org — and the retrieval chain consults
them in that relevance order (a caller's own context first, widening outward to the whole-org
corpus). This package is the single source of truth for that order, so the derivation, the runtime
contract, and the scope-aware retrieval plugin can never disagree.

```
 agent asks a question
        │  retrieval query (tenant — one customer's isolated workspace — and dataset scope)
        ▼
 ┌──────────────────────────────────────────┐
 │  retrieval   ◄── HERE                      │  scope precedence Personal→…→Org
 │  · source registry (CRUD /third-party-…)   │  types shared with policy authorization
 │  · DatasetScope + query/result contracts   │
 └──────────────────────────────────────────┘
        │  scoped, authorized query
        ▼
 Cognee org index  →  ranked documents back to the agent
```

Invariant: the scope precedence list is defined once and is the only ordering any component keys
off. Every source-governance operation requires the exact organisation `administer` grant. A write,
its central authorization evidence, and its operator audit entry share one database transaction, so
none can commit alone. If the ordering drifted, a query could pull broader context than the caller
should see — so it stays centralised here.

## Public surface

- `DatasetScope` + `DATASET_SCOPE_RETRIEVAL_PRECEDENCE` — the scope enum and the narrow→broad relevance order.
- `RetrievalQueryRequest`, `RetrievalResult`, `RetrievalQueryResponse`, `RetrievalErrorResponse` — the retrieval API contract shared with conformance tests.
- `thirdPartySourcesRouter` (mounted at `/api/v1/third-party-sources`) — CRUD over the source inventory and its discovered items, plus the tenant-dataset types.
- `PrismaThirdPartySourceUnitOfWork` and `PrismaThirdPartySourceRepository` — bind source queries,
  writes, and central authorization to one transaction.
- Source authority and caller types — the trusted contracts shared by route composition and tests.

## Boundary

Consumed by the opencrane-server HTTP layer and by grants (dataset authorization keys off these
scope types). It defines the retrieval contract and owns the source registry; the central
`AuthorizationAuthority` makes source-governance decisions, while the retrieval plugin and grants
retain query execution and dataset-scope authorization respectively.

## Dependency direction

Tagged `scope:retrieval`: it may depend on authentication, authorization, retrieval, and shared
contracts, never on apps or sibling product domains. Grants still depends on retrieval, not the
reverse.

## Data & persistence

Owns `ThirdPartySource`, `ThirdPartySourceItem`, and `TenantDatasetMembership` (with the
`DatasetScope`, `ThirdPartySourceKind`, `ThirdPartySourceStatus`, and `ThirdPartySourceItemKind`
enums) in `apps/opencrane/prisma/schema/retrieval.prisma`. Each source stores its owning `siloId`,
and source names are unique inside that silo instead of globally. Item access starts from the
silo-scoped parent source.

## See also

- Parent index: [knowledge](../../README.md)
- Sibling: [company-docs](../../company-docs/main/README.md)
