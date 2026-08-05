# @opencrane/backend/server/agents/skills — safe skill catalogue

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › skills

## What it owns

A *skill* is a reusable capability an agent can be given — packaged code plus metadata. Like an
agent service, a skill has a stable identity and immutable, versioned revisions. The OpenCrane app
uses this package for the live, read-only catalogue API: an authenticated browser session and
request host select the silo, and callers receive only safe skill metadata.

```
 governed Skill + current SkillRevision
        ▼
 ┌──────────────────────────────────┐
 │  skills  ◄── HERE                 │  trusted silo? bounded, deterministic list?
 │                                   │  browser-safe fields only?
 └──────────────────────────────────┘
        │  safe catalogue summaries
        ▼
 browser catalogue  ──► discovery only; never a skill bundle or execution authority
```

**In this flow:** [artifacts](../../artifacts/main/README.md) *(holds the bundle)* · [agent-services](../../agent-services/main/README.md) *(assigns skills to managed agent revisions)*

Invariant: the catalogue is limited to 200 skill summaries from the exact trusted silo, in stable
newest-first order. It exposes no artifact addresses, bundle bytes, manifests, requirements, review
evidence, signatures, signer identities, or worker coordinates. A failure to read the catalogue
returns unavailable rather than a partially widened result.

## Public surface

- `__CreateSkillCatalogueRouter` — serves `GET /api/v1/skills`, a bounded catalogue of skill name,
  description, lifecycle, and current-revision state in the trusted host silo.
- `_CreateSkillCatalogueRouter` — the ready-to-mount Prisma composition that authenticates through
  the shared request-principal seam and supplies the catalogue repository.
- `SkillCatalogueRepository` and `SkillCatalogueEntry` — the narrow read boundary and safe summary
  shape used by the browser catalogue.
- `SkillCatalogueStates` and `SkillCatalogueRevisionStates` — the documented serialized lifecycle
  vocabularies used by the browser response and OpenAPI specification.

## Boundary

The application mounts the exported router and supplies the Prisma-backed catalogue repository. This
package does not author, test, scan, sign, publish, revoke, download, or execute skills, and it does
not store bytes. Those unreachable lifecycle paths were removed rather than retained beside the live
catalogue authority.

The catalogue deliberately excludes artifact content addresses, bundle bytes, manifests,
requirements, test and scan evidence, signatures, signer keys, reviewer identities, and all
authoring or tool-runner workload coordinates. It is a discovery surface, not a skill authoring,
publication, download, or execution API.

## Dependency direction

Tagged `scope:skills`: it may depend only on `scope:artifacts`, `scope:cluster-tenants`,
`scope:auth`, `scope:grants`, `scope:skills`, and `scope:shared` — never on apps, gateways, or other agent
domains directly.

## Data & persistence

The `Skill`, `SkillRevision`, and authoring-only `SkillWorkload` tables belong to the broader skill
capability in `apps/opencrane/prisma/schema/skills.prisma`. This read package owns none of their
lifecycle transitions; it selects only browser-safe fields.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [artifacts](../../artifacts/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
