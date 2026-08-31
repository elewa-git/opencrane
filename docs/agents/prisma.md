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
3. **Schema changes edit the target baseline; there is no upgrade path pre-1.0.** Regenerate and
   review `apps/opencrane/prisma/bootstrap/target-baseline.sql`, then prove it against a new empty
   database. Prisma's generated diff does not contain the hand-written triggers, partial/NULL-safe
   indexes, and authority constraints in the reviewed baseline. Regeneration must preserve and
   revalidate those blocks explicitly. Update `database.baselineSha256` in the current
   `releases/<version>.json` and rebuild any live dev silo that needs the new schema. Run
   `npm run test:authority-baseline -w @opencrane/server` as well: it fails closed when a
   Prisma-only rewrite has discarded the reviewed functions, triggers, constraints, or seeds.
4. **CNPG `initdb` is the only application-schema setup boundary.** The deployment publisher
   prepends `SET ROLE` for the configured application owner and exposes the canonical SQL through
   one immutable, content-addressed ConfigMap. Its superuser envelope records the full baseline
   digest in a protected database schema. Physical recovery restores that marker with the existing
   schema, never attaches fresh setup SQL, and must pass the digest-checking Postgres hook.
   Existing databases do not advance in place pre-1.0 — a silo that needs a newer schema is
   rebuilt (see [`versioning.md`](./versioning.md)); the protected baseline digest remains
   immutable origin proof.

## Runtime ORM ownership

Production TypeScript reaches Prisma through reviewed capability boundaries, enforced by
`npm run check:prisma-boundaries -- --diff <base-ref>`:

1. Domain services, materializers, and use cases do not import Prisma or call model delegates.
2. Only an exact repository adapter declared in
   [`prisma-boundary-policy.json`](./prisma-boundary-policy.json) may call model delegates. A
   declaration binds the repository contract import, adapter class, and source path; renaming or
   moving any of them requires policy review. `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, and
   `$executeRawUnsafe` are forbidden in production TypeScript, including declared repositories.
	The permanent exceptions are the typed `WorkflowTaskAdmission` and `WorkflowTaskEventAdmission`
	adapters. They call the fixed, parameterized `absurd.spawn_task` and `absurd.emit_event`
	templates, each bound by exact path, class, contract, method, SQL template, and canonical-LF source
	SHA-256 registered in the checker and mirrored in the checked policy. Recompute and update the
	enforcement-owned source pin only after reviewing the complete adapter; any import, helper, or
	statement change deliberately invalidates the raw-procedure exception.
3. Only an exact declared UnitOfWork adapter may call `$transaction`.
4. Passing a transaction client into another repository is also policy-owned. Every declared
	repository constructor accepts `Prisma.TransactionClient`, and each declared construction must
	receive the exact `$transaction` callback binding (or an owning repository's typed transaction
	property), never the root `PrismaClient`. Stale declarations and substituted bindings fail.
5. Composition roots may import `PrismaClient` only at exact listed paths. That permits dependency
   wiring, never delegate or transaction ownership.

The checker compares new findings with the base revision, so inherited violations remain visible
through `--all` without blocking unrelated slices. Exact temporary exemptions require an owner,
reason, an allowed delegate or transaction operation, and a real UTC calendar expiry; malformed or
stale policy fails closed. Raw Prisma methods cannot be authorized by an owner declaration or a
temporary exemption; apart from the fixed durable-admission procedure above, database-specific
invariants belong in the reviewed target baseline while repositories access them through typed delegates.

## Why this exists

Per-domain schema files keep model ownership attributable while one reviewed target SQL describes
the product OpenCrane creates today. Git history records older shapes; the runtime does not carry them.
