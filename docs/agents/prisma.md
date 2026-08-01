# Prisma schema and target baseline ownership

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

The OpenCrane server database schema is owned **per domain**, mirroring the
`libs/backend/<domain>/main` package layout (#153). One physical PostgreSQL database and one
clean target baseline remain, and every model/enum has exactly one owning domain.

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
3. **Schema changes update the target baseline in the same slice.** Regenerate and review
   `apps/opencrane/prisma/bootstrap/target-baseline.sql`, then prove it against a new empty database.
   Prisma's generated diff does not contain the hand-written triggers, partial/NULL-safe indexes,
   and authority constraints in the reviewed baseline. Regeneration must preserve and revalidate
   those blocks explicitly. Do not add incremental scripts or a runtime schema runner.
4. **CNPG `initdb` is the only application-schema setup boundary.** The deployment publisher
   prepends `SET ROLE` for the configured application owner and exposes the canonical SQL through
   one immutable, content-addressed ConfigMap. Its superuser envelope records the full baseline
   digest in a protected database schema. Physical recovery restores that marker with the existing
   schema, never attaches fresh setup SQL, and must pass the digest-checking Postgres hook.
5. **Package-owned SQL authority tests live with the domain source.** Put each hand-written
   authority suite beneath the owning package's `src/**/__tests__/` folder, then make that
   package's `test:sql` target name the exact relative path. This keeps test discovery tied to the
   same domain boundary as the TypeScript tests and prevents an unowned top-level `tests/` folder
   from becoming a second package surface.

## Why this exists

Per-domain schema files keep model ownership attributable while one reviewed target SQL describes
the product OpenCrane creates today. Git history records older shapes; the runtime does not carry them.
