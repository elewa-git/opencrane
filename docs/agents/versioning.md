# Release versions and upgrade migrations

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Version authorities

The root [`package.json`](../../package.json) version names the current repository train. Every Nx
application records `metadata.release.adaptedVersion`: the exact repository version in which files
under that application's own root last changed. An application whose own files did not change keeps
its latest released value, even when a shared library, the root dependency set, or the lockfile
moved underneath it — published images are pinned by commit SHA, so those shared changes reach the
application without a per-application stamp. Existing app `package.json` versions and app-owned
Helm chart versions are checked mirrors, never competing authorities.

The initial `adoptionBaseline` is the explicit exception: it stamps the observed fleet composition
at the train where this ledger was introduced, because older per-app adaptation history was not
recorded. After adoption, every stamp is the exact last adapted train and older manifests are
immutable. Once a repository-version tag exists, production or deployment composition may not
change under that same version.

[`releases/`](../../releases/README.md) is the immutable composition history. Each root version maps
the app, chart, and database schema versions known to work together. Stamp exactly the applications
that own a changed file under their project root. Do not equate Nx's `affected` result with
adaptation: a dependency-graph or shared-configuration change can mark an app affected without
requiring a new stamp.

This follows Nx's independent-release principle—projects retain their own last meaningful version—
without enabling `nx release` as a second version authority. Nx
[independent releases](https://nx.dev/docs/guides/nx-release/release-projects-independently) and
[version plans](https://nx.dev/docs/guides/nx-release/file-based-versioning-version-plans) assume
package-oriented release groups. OpenCrane instead has one operator-selected repository train plus
heterogeneous app, Helm, image, and database revisions, so the Nx project graph supplies the app
inventory while the checked release manifest records the deployable composition and migration
evidence. If this workflow is automated further, use Nx's
[programmatic release API](https://nx.dev/docs/guides/nx-release/programmatic-api) behind this same
manifest contract; do not introduce parallel version files.

## Transition policy

- For an upgrade, the deployer accepts only the release manifest's immediate predecessor and runs
  the dedicated Prisma migration Job. Prisma's `_prisma_migrations` table decides which saved
  changes still need to run; the deployer does not select version-pair SQL.
- A fresh installation uses the target baseline and skips the migration Job.
- A directly changed application is stamped to the current full root version. This is a
  compatibility stamp, not a claim that every application releases in lockstep.
- Shared library, root dependency, and lockfile changes stamp nothing on their own: the affected
  applications keep their latest released version and receive the shared change through their
  SHA-pinned images.
- Never rewrite an older release manifest. Create the next manifest by carrying unchanged component
  versions forward and updating only directly changed owners.

## Helm migrations

A changed app-owned chart updates its chart version to the current root version and adds exactly one
`helm/migrations/<from>-to-<to>.json` transition from the version recorded in the previous release
manifest. Bind the file with `fromChartVersion` and `toChartVersion`. The currently executable kind
is `noop`. The checker rejects value-transform declarations until the deploy owner implements and
tests their consumer, so a migration can never be accepted and then silently ignored. A newly
introduced chart has no predecessor and therefore no transition. A migration consumes a retired
shape once and emits only the current shape; do not retain compatibility aliases in templates or
values.

The umbrella chart declares each local dependency with an open version constraint: every
dependency is an in-repo `file://` chart, so the checked-out commit is the version authority and
`helm dependency update` packages the sources fresh at render time. There is no `Chart.lock` or
vendored archive to keep in step — a chart stamp needs no umbrella edit at all. The release gate
still fails when a chart-bearing application is not declared in the umbrella. PostgreSQL's chart
version tracks the OpenCrane wrapper; its `appVersion` remains the pinned PostgreSQL engine major.

## Database migrations

The clean target baseline remains the fresh-install authority. Prisma Migrate is the only upgrade
ledger. A schema change adds the next reviewed directory under
`apps/opencrane/prisma/prisma-migrations/`; do not add a second version-pair SQL manifest. The
directory name starts with a sortable UTC timestamp and ends with a short description. Prisma stores
the applied name and checksum in `_prisma_migrations`.

The server never migrates on startup. `apps/opencrane-prisma-migrator` packages the schema and Prisma
ledger, and `apps/postgres` owns the bounded Job that runs `prisma migrate deploy` from that immutable
image. A failed migration is repaired forward. It does not require a backup, separate schema version
check, write pause, or automatic recovery. Issue #699 tracks those deferred hardening controls.

Released migration history stays where it was published. Because `0.9.3` was never tagged, the
0.10.0 cutover starts from the tagged 0.9.2 release and carries its 0.9.0 database schema through the
reviewed IAM prerequisite before Prisma applies the 0.10.0 cutover. The deployment must first let
CloudNativePG reconcile `pg_cron`, then observe a second `Database` generation that assigns the
existing `cron` schema to the application owner. The migration Job must never receive the
CloudNativePG superuser credential.

## Required gate

Before review run:

```bash
npm run check:release-versioning -- --base "$WAVE_BASE"
npm run test:release-versioning
```

The checker rejects missing app stamps, package/chart mirror drift, an incomplete release manifest,
untracked baseline bytes, and future chart/database changes without their version-to-version path.

An unreleased candidate records `previousRepositoryCommit`: the exact commit of its declared
predecessor train. PR validation uses that commit until the predecessor tag exists. Release
qualification requires the predecessor's immutable Git tag before the new release tag can publish
an artifact or represent a deployable upgrade path. That tag must point to the recorded commit, so
it cannot silently change the upgrade path that PR validation checked.
