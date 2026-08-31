# Versions and migrations

OpenCrane is **pre-1.0**. There is no version-to-version upgrade path: one current release
manifest binds the fresh-install database baseline, and a schema change is made by editing that
baseline directly, not by writing a migration. Upgrade contracts return once OpenCrane reaches
MVP.

> See also: [The CI pipeline](/contributing/ci-pipeline) (where `check:release-versioning` runs),
> [Deploying](/contributing/deploying) (how a fresh install applies the baseline through CNPG),
> and [Letting an AI agent manage your deployment](/contributing/ai-managed-deployment) (why an
> agent must rebuild a dev silo rather than attempt an in-place schema upgrade).

## What the release manifest binds

The root `package.json` version (for example `0.9.3`) names the one manifest CI checks,
[`releases/<version>.json`](https://github.com/elewa-git/opencrane/blob/main/releases). Pre-1.0 it
is not immutable and no new manifest is required per change — a schema change updates the same
file in place.

| Field | What it is |
| --- | --- |
| `repositoryVersion` | Must equal the root `package.json` version. |
| `database.baselinePath` | The fresh-install authority, [`apps/opencrane/prisma/bootstrap/target-baseline.sql`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/bootstrap/target-baseline.sql). |
| `database.baselineSha256` | SHA-256 of that file. `check:release-versioning` recomputes the digest and fails the build if it drifts. |
| `database.operandImage` | The tagged, digest-pinned CloudNativePG PostgreSQL operand. Its tag's major version must agree with `projects.postgres.externalAppVersion`. |
| `projects` | One entry per Nx application; only `root` is required. Older fields (`adaptedVersion`, `chartVersion`, `manualTransition`, `previousRepositoryVersion`) stay in the schema so historical manifests keep validating, but no current rule reads them. |

There are no version-to-version SQL migration directories, no Helm chart `migrations/*.json`
transitions, and no per-change version-bump ceremony — all removed as part of the pre-1.0
baseline-only decision recorded in the deploy ledger's
[2026-08-31 entry](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).

## Making a schema change

1. Edit `target-baseline.sql` directly — it is the only fresh-install authority.
2. Recompute its SHA-256 and update `database.baselineSha256` in the current
   `releases/<version>.json`.
3. Rebuild affected dev silos instead of upgrading them: teardown, then a fresh install applies
   the new baseline through CNPG `initdb`.

::: warning
Do not attempt an in-place schema upgrade on a dev silo while this policy stands. An existing
cluster keeps the schema it already has — CNPG only applies the baseline to a fresh cluster. If a
silo needs the new schema, rebuild it and accept the data loss.
:::

## CI enforces the one manifest

::: tip
`check:release-versioning` (`node scripts/release-versioning-check.mjs`) validates only the
current manifest: it binds the root version, checks the baseline file exists and matches its
digest, and checks the PostgreSQL operand tag against the chart's declared major version. It does
not diff against a base ref or walk a version history.
:::

## What returns at MVP

Reviewed schema transitions and an in-place upgrade path return once OpenCrane reaches MVP, most
likely as a Prisma-ledger migrator Job (see the deploy ledger's 2026-08-31 entry).

Source: [`scripts/release-versioning-check.mjs`](https://github.com/elewa-git/opencrane/blob/main/scripts/release-versioning-check.mjs),
[`releases/README.md`](https://github.com/elewa-git/opencrane/blob/main/releases/README.md), and
[`docs/agents/deploy-ledger.md`](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).
