# Versions and migrations

OpenCrane ships one **repository train** made of many independently versioned applications,
Helm charts and a shared database schema. This page covers how a change stamps its version,
how chart and database migrations are recorded, and how CI enforces all of it.

> See also: [The CI pipeline](/contributing/ci-pipeline) (where `check:release-versioning` runs),
> [Deploying](/contributing/deploying) (why `helm dependency build`, never `dependency update`,
> matters here), and the full policy in
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
`helm/migrations/<from>-to-<to>.json` transition. The umbrella's `Chart.lock` and packaged
archives are then regenerated and reviewed (with `helm dependency build`, never
`dependency update` — see [Deploying](/contributing/deploying)). A newly introduced chart has no
predecessor and therefore no transition.

## Database migrations

A database schema change updates the clean target baseline and adds one adjacent, reviewed SQL
transition under
[`apps/opencrane/prisma/migrations/<from>-to-<to>/`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/migrations),
bound by digest.

- **Adjacent minor trains** (`0.8.x → 0.9.0`) are the only automatic transition.
- **Patch, skipped-minor, and major transitions** require an approved `manualTransition` with a
  reason recorded in the manifest — tooling never guesses the upgrade path.

## CI enforces the whole scheme

::: tip
`check:release-versioning` runs inside the `test` job of [`docker.yml`](/contributing/ci-pipeline),
diffed against the last validated base. A violation fails the pull request — not the deploy.
:::

Source: [`docs/agents/versioning.md`](https://github.com/elewa-git/opencrane/blob/main/docs/agents/versioning.md)
and [`scripts/release-versioning-check.mjs`](https://github.com/elewa-git/opencrane/blob/main/scripts/release-versioning-check.mjs).
