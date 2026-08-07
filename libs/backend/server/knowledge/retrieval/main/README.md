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
off. The source registry writes an audit entry on every create / update / delete, so the record of
what feeds org memory stays traceable. If the ordering drifted, a query could pull broader context
than the caller should see — so it stays centralised here.

## Public surface

- `DatasetScope` + `DATASET_SCOPE_RETRIEVAL_PRECEDENCE` — the scope enum and the narrow→broad relevance order.
- `RetrievalQueryRequest`, `RetrievalResult`, `RetrievalQueryResponse`, `RetrievalErrorResponse` — the retrieval API contract shared with conformance tests.
- `thirdPartySourcesRouter` (mounted at `/api/v1/third-party-sources`) — CRUD over the source inventory and its discovered items, plus the tenant-dataset types.

## Boundary

Consumed by the opencrane-server HTTP layer and by grants (dataset authorization keys off these
scope types). It defines the retrieval contract and owns the source registry; it does not itself
run the Cognee query or make the allow/deny decision — those live in the retrieval plugin and in
grants respectively.

## Dependency direction

Tagged `scope:retrieval`: it may depend only on `scope:retrieval` and `scope:shared` — never on
apps or sibling domains. (Note that grants depends on retrieval, not the reverse.)

## Data & persistence

Owns `ThirdPartySource`, `ThirdPartySourceItem`, and `TenantDatasetMembership` (with the
`DatasetScope`, `ThirdPartySourceKind`, `ThirdPartySourceStatus`, and `ThirdPartySourceItemKind`
enums) in `apps/opencrane/prisma/schema/retrieval.prisma`.

## See also

- Parent index: [knowledge](../../README.md)
- Sibling: [company-docs](../../company-docs/main/README.md)
