# @opencrane/backend/server/api-spec — control-plane OpenAPI source

The single source of truth for the OpenCrane control-plane HTTP contract. `spec` assembles the
OpenAPI 3.1 document from the path fragments each backend domain exports (awareness, tenants,
projection, policies, mcp, grants, groups, retrieval, access-tokens, providers, model-routing,
spend, audit, metrics) plus shared components such as the error envelope and pagination. Route
changes are made here, then `npm run emit-openapi -w @opencrane/server` and
`nx run contracts:generate` regenerate the committed contracts client; the emitted `openapi.json`
is a dist artifact, not source.

The library carries no runtime behaviour — no routing, validation, or handlers. The OpenCrane
server (`apps/opencrane/src/app/routes.ts`) consumes it to emit the spec; domains contribute
fragments but never import this package back, keeping the aggregation direction one-way.

Tagged `scope:api-spec`: it may depend on the contributing domain scopes listed in
`eslint.config.mjs` plus `scope:shared`, and nothing may flow the other way except apps.

See [`../../README.md`](../../README.md) for the control-plane capability map.
