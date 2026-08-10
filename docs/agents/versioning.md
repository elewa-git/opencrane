# Release versions and upgrade migrations

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Version authorities

The root [`package.json`](../../package.json) version names the current repository train. Every Nx
application records `metadata.release.adaptedVersion`: the exact repository version in which that
application's production or deployment contract was last adapted, either directly or through a
changed project in its Nx dependency graph. Unchanged applications
retain their older value. Existing app `package.json` versions and app-owned Helm chart versions are
checked mirrors, never competing authorities.

The initial `adoptionBaseline` is the explicit exception: it stamps the observed fleet composition
at the train where this ledger was introduced, because older per-app adaptation history was not
recorded. After adoption, every stamp is the exact last adapted train and older manifests are
immutable. Once a repository-version tag exists, production or deployment composition may not
change under that same version.

[`releases/`](../../releases/README.md) is the immutable composition history. Each root version maps
the app, chart, and database schema versions known to work together. Use the Nx project graph to
start from directly changed project roots and stamp the applications that own those roots or depend
on them. Do not equate Nx's broader `affected` result with adaptation: named inputs such as shared
configuration can mark an app affected without changing its production or deployment contract.

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

- Adjacent minor trains are the only automatic transition: for example `0.7.x` to `0.8.0`.
- Patch, skipped-minor, and major transitions are manual. The release manifest must record an
  approved `manualTransition` with its reason; tooling never guesses the upgrade path. This records
  review admission only: the generic deploy resolver deliberately rejects the transition until its
  version-specific operator procedure is implemented, reviewed, and invoked manually.
- A directly changed application, and an application depending on a changed project, is stamped to
  the current full root version. This is a compatibility stamp, not a claim that every application
  releases in lockstep.
- A semantic root dependency or lockfile change stamps every application because the shared runtime
  boundary cannot be mapped safely to a smaller owner set. Root/version-only mirror edits do not.
- Never rewrite an older release manifest. Create the next manifest by carrying unchanged component
  versions forward and updating only directly or dependency-adapted owners.

## Helm migrations

A changed app-owned chart updates its chart version to the current root version and adds exactly one
`helm/migrations/<from>-to-<to>.json` transition from the version recorded in the previous release
manifest. Bind the file with `fromChartVersion` and `toChartVersion`. The currently executable kind
is `noop`. The checker rejects value-transform declarations until the deploy owner implements and
tests their consumer, so a migration can never be accepted and then silently ignored. A newly
introduced chart has no predecessor and therefore no transition. A migration consumes a retired
shape once and emits only the current shape; do not retain compatibility aliases in templates or
values.

The umbrella chart pins each local dependency to its owning chart version. Regenerate and review
`Chart.lock` and packaged dependencies after a chart stamp changes. PostgreSQL's chart version tracks
the OpenCrane wrapper; its `appVersion` remains the pinned PostgreSQL engine major.

## Database migrations

The clean target baseline remains the fresh-install authority. A schema change also adds an adjacent,
reviewed SQL transition under `apps/opencrane/prisma/migrations/<from>-to-<to>/`, where `from` is the
database schema version in the previous repository manifest, not merely the previous repository
version. Its manifest binds source version, target version, SQL digest, owner, and rollback mode. The
migration must:

1. acquire the migration advisory lock;
2. require the exact current schema version;
3. run transactionally and fail closed;
4. update schema history only after success; and
5. preserve the protected bootstrap digest as origin evidence.

The server never migrates on startup. `apps/postgres` owns the bounded migration Job; the deployment
owner sequences it before an incompatible server rollout. Rollback is backup/restore or a reviewed
forward repair, not an old-runtime compatibility layer.

Prove both paths converge: migrate a previous-version database and independently create a fresh
database from the current baseline, then compare normalized schemas and rerun authority, trigger,
and seed tests.

## Required gate

Before review run:

```bash
npm run check:release-versioning -- --base "$WAVE_BASE"
npm run test:release-versioning
```

The checker rejects missing app stamps, package/chart mirror drift, an incomplete release manifest,
untracked baseline bytes, and future chart/database changes without their version-to-version path.
