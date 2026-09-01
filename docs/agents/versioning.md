# Release versioning (pre-1.0)

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Until the MVP release, OpenCrane supports exactly one install path: a fresh install from the clean
database baseline. There are no version-to-version upgrade contracts — no per-change version bumps,
no manifest immutability, no chart version stamps, no `helm/migrations` files, and no reviewed SQL
transitions. The decision is recorded in
[`deploy-ledger.md`](./deploy-ledger.md) (2026-08-31 entry). Existing dev silos that need a newer
schema are rebuilt, never upgraded in place.

## What the manifest binds

The root [`package.json`](../../package.json) version names the current release, and
`releases/<version>.json` is its one current manifest (see
[`releases/README.md`](../../releases/README.md)). It binds the three things deployment consumes:

- the repository version — `repositoryVersion` must match the root `package.json`;
- the fresh-install baseline — `database.baselinePath` names
  `apps/opencrane/prisma/bootstrap/target-baseline.sql` and `database.baselineSha256` records its
  digest;
- the PostgreSQL operand image — `database.operandImage`, whose tag major must match
  `projects.postgres.externalAppVersion`, because CNPG reads the major version from the tag.

`npm run check:release-versioning` ([`scripts/release-versioning-check.mjs`](../../scripts/release-versioning-check.mjs))
enforces exactly that — the root version is strict semver, the manifest exists, passes the schema,
and binds that version, the baseline matches its recorded digest, and the operand tag major agrees
with the chart — and nothing more.

## Making a schema change

1. Edit `apps/opencrane/prisma/bootstrap/target-baseline.sql` (rules in
   [`prisma.md`](./prisma.md)).
2. Update `database.baselineSha256` in the current `releases/<version>.json`.
3. Rebuild any live dev silo that needs the new schema, or have an agent apply the SQL to that silo
   directly.

Historical `releases/*.json` files are kept only because `teardown.sh` reads them to retire silos
installed from them.

Upgrade contracts return at MVP, most likely as a Prisma-ledger migrator Job.
