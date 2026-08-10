# Release compatibility ledger

Each JSON file named after a root `package.json` version is the immutable composition record for
that repository train. It records the database schema and the last repository version in which each
Nx application was adapted directly or by a changed project in its Nx dependency graph. An
unchanged app keeps its older stamp, so a repository release
can truthfully combine independently evolved server, UI, database, worker, and chart revisions.
The `adoptionBaseline` is a one-time observed-composition stamp for history that predates this
ledger; all later stamps identify the exact last adapted train.

The current root version is the only automatic version source. Adjacent minor transitions are the
automatic migration boundary. Patch and major transitions require a reviewed `manualTransition` in
the new manifest; the generic deploy resolver does not execute them. A version-specific reviewed
operator procedure must own those manual data and chart changes.

When a project changes production source or deployment configuration, update the owning Nx
application and every application that depends on that project to the current root version in
`metadata.release.adaptedVersion`, and mirror that value into any app `package.json`. A changed
app-owned chart also updates `Chart.yaml` and carries an explicit
`helm/migrations/<from>-to-<to>.json` transition bound by `fromChartVersion` and `toChartVersion`,
including `kind: "noop"` when the rendered object/value shape needs no migration or a non-empty
value migration only after the deployment workflow has an executable, regression-tested consumer.
Unsupported value-transform declarations fail validation rather than being ignored. A database schema change updates the clean target baseline,
the manifest's schema version and digest, and a reviewed
`apps/opencrane/prisma/migrations/<from>-to-<to>/migration.sql` path.

Run `npm run check:release-versioning -- --base <ref>` before review. The checker uses directly
changed project roots plus reverse dependencies from the Nx project graph rather than Nx's broader
`affected` result, because shared inputs can make untouched apps affected without adapting their
release contract.
