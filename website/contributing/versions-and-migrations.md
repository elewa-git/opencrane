# Versions and migrations

OpenCrane ships one **repository train** made of many independently versioned applications,
Helm charts and a shared database schema. This page covers how a change stamps its version,
how chart and database migrations are recorded, and how CI enforces all of it.

> See also: [The CI pipeline](/contributing/ci-pipeline) (where `check:release-versioning` runs),
> [Deploying](/contributing/deploying) (how the umbrella derives its subchart packaging), and the
> full policy in
> [`docs/agents/versioning.md`](https://github.com/elewa-git/opencrane/blob/main/docs/agents/versioning.md).

## The repository train and the release manifest

The root `package.json` version names the current train (for example `0.9.2`). Each train has an
immutable manifest, [`releases/<version>.json`](https://github.com/elewa-git/opencrane/blob/main/releases),
recording every application's `adaptedVersion`, chart version and the database schema version
that work together. Once a version tag exists, that train's composition is frozen: any further
change must advance the train and create the next manifest.

## The stamp rule

Only applications whose own files changed stamp to the root version:

```text
did this application's own project-root files change?
        │
   yes ─┴─ no
    │        │
    ▼        ▼
 stamp to   keep its latest
 the root   released version
 version         │
    │        (a shared library, the root
    ▼        dependency set, or the lockfile
update, together:      moving underneath it does
  · manifest entry     not trigger a stamp — the
  · package.json       published image is pinned
    version mirror     by commit SHA, so the
  · project.json       shared change reaches the
    adaptedVersion     app regardless)
  · chart appVersion
    (if a chart exists)
```

Before this rule, every shared change failed CI until every manifest entry was bumped by hand.
Version-only mirror edits are "stamp-only" and do not count as changes themselves.

## Chart migrations

A changed chart bumps its chart version to the root version and adds exactly one
`helm/migrations/<from>-to-<to>.json` transition. The umbrella needs no edit: it declares its
in-repo dependencies with open constraints and packages them fresh at render time (see
[Deploying](/contributing/deploying)). A newly introduced chart has no predecessor and therefore
no transition, but it must be declared as an umbrella dependency — the release gate fails when a
chart-bearing application is missing there.

## Database migrations

A database schema change updates the clean target baseline and adds one reviewed Prisma migration
under
[`apps/opencrane/prisma/prisma-migrations/`](https://github.com/elewa-git/opencrane/tree/main/apps/opencrane/prisma/prisma-migrations).
Tagged 0.9.2 is the direct predecessor of 0.10.0 and still records schema 0.9.0, so its bounded
migration Job first runs the digest-bound IAM prerequisite and then starts the Prisma ledger.
CloudNativePG prepares the required `pg_cron` extension before that Job runs: one observed
`Database` generation installs the extension and the next assigns the existing `cron` schema to the
OpenCrane owner. The migration container receives only the application credential.

- The release manifest names the exact tagged predecessor and commit.
- Fresh databases use the target baseline and skip the migration Job.
- Development databases that ran the untagged 0.9.3 candidate need a reset or reviewed forward
  repair; the release tooling never treats that candidate as published history.

## CI enforces the whole scheme

::: tip
`check:release-versioning` runs inside the `test` job of [`docker.yml`](/contributing/ci-pipeline),
diffed against the last validated base. A violation fails the pull request — not the deploy.
:::

Source: [`docs/agents/versioning.md`](https://github.com/elewa-git/opencrane/blob/main/docs/agents/versioning.md)
and [`scripts/release-versioning-check.mjs`](https://github.com/elewa-git/opencrane/blob/main/scripts/release-versioning-check.mjs).
