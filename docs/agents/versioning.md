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

- The deployer reads the database schema labels from the requested release manifests and uses a
  reviewed `<from>-to-<to>` directory when it exists. It does not inspect the live database to admit
  the migration.
- A release without a matching migration directory continues with the ordinary PostgreSQL rollout.
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

The clean target baseline remains the fresh-install authority. A schema change also adds an adjacent,
reviewed SQL transition under `apps/opencrane/prisma/migrations/<from>-to-<to>/`, where `from` is the
database schema version in the previous repository manifest, not merely the previous repository
version. Its manifest binds source version, target version, SQL digest, owner, and rollback mode. The
migration must:

1. acquire the migration advisory lock;
2. run transactionally; and
3. update schema history only after success.

The server never migrates on startup. `apps/postgres` owns the bounded migration Job; the deployment
owner runs it as a direct migration Job. A failed migration is repaired forward; it does not require
a backup, schema check, write pause, or automatic recovery. Issue #699 tracks the deferred hardening
work.

## Required gate

Before review run:

```bash
npm run check:release-versioning -- --base "$WAVE_BASE"
npm run test:release-versioning
```

The checker rejects missing app stamps, package/chart mirror drift, an incomplete release manifest,
untracked baseline bytes, and future chart/database changes without their version-to-version path.
