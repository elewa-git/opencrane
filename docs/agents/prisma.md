# Prisma Schema & Migration Ownership

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

The OpenCrane server database schema is owned **per domain**, mirroring the
`libs/backend/<domain>/main` package layout (#153). One physical PostgreSQL database and one
migration history remain, but every model/enum has exactly one owning domain.

## Schema layout

- The schema is a **multi-file folder**: `apps/opencrane/prisma/schema/`
  (Prisma ≥ 6.7 folder mode; wired via `"prisma": { "schema": "prisma/schema" }` in the
  operator `package.json`).
- `base.prisma` holds the `generator` and `datasource` blocks — nothing else.
- `<domain>.prisma` holds the models and enums owned by `libs/backend/<domain>/main`
  (e.g. `grants.prisma`, `model-routing.prisma`). Cross-file relations are fine — Prisma
  merges the folder into one schema.

## Rules

1. **New model/enum → the owning domain's file.** If the owning domain package doesn't
   exist yet, create the lib first (see `libs/backend/README.md`); a model with no owning
   domain is a design smell.
2. **Never edit a model from a non-owning domain.** If domain B needs a field on domain
   A's model, that is an API conversation with A's contract, not a schema edit from B.
3. **Migration names carry the owning domain**: `NNNN_<domain>_<description>`
   (e.g. `0033_grants_share_expiry`). One migration touches ONE domain's models wherever
   possible; a genuinely cross-domain migration names the driving domain and says so in
   an SQL comment at the top.
4. **Migration history stays single** (`prisma/migrations/`): Prisma tracks one
   `_prisma_migrations` table per database. Per-domain ownership is a naming + review
   convention on top, not separate histories.

## Why this exists

Wave 5's plugin system needs plugins that own their own migrations. Per-domain schema
files + domain-prefixed migrations are the stepping stone: a future plugin's schema
slice is already isolated in one file with an attributable migration trail.
