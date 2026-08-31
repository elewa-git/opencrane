# The CI pipeline

Every pull request and every push to `develop` or `main` runs through **three GitHub Actions
workflows**. This page covers what each job gates and the caching that keeps the pipeline fast
enough to stay in the loop.

> See also: [Contributing overview](/contributing/overview) (where this fits in the PR-to-cluster
> journey), [Deploying](/contributing/deploying) (what consumes the images this pipeline
> publishes), and [Versions and migrations](/contributing/versions-and-migrations) (the
> pre-1.0 release-manifest check that `check:release-versioning` runs inside the `test` job).

## The three workflows

| Workflow | File | Purpose | Typical duration |
| --- | --- | --- | --- |
| Validate and publish affected deployables | [`docker.yml`](https://github.com/elewa-git/opencrane/blob/main/.github/workflows/docker.yml) | The main pipeline: build, test, smoke and publish | minutes (see below) |
| Enforce pull-request stack integrity | [`pr-stack-integrity.yml`](https://github.com/elewa-git/opencrane/blob/main/.github/workflows/pr-stack-integrity.yml) | Stacked-PR bookkeeping | under a minute |
| CodeQL | GitHub's default code-scanning setup | Static analysis | a few minutes |

`docker.yml` is where the time goes, so the rest of this page is about its jobs.

## The pipeline fan-out

```text
pull request / push to develop, main
        │
        ▼
   prepare
   computes the affected graph, the deployable matrix, the guard
   comparison base, and whether the k3d smoke can be skipped
        │
        ├──→ test                 build, test, lint, every policy guard
        ├──→ database             fresh-baseline apply, SQL authority suites
        ├──→ api_contract         OpenAPI + generated client (when affected)
        ├──→ storybook_visual     component contracts, cached Chromium
        ├──→ develop_smoke        k3d silo smoke — the long pole
        └──→ image_smoke          per-image boot checks
        │
        ▼   (all must pass)
   build-and-push
   publishes sha-<commit> images on push events;
   on pull requests it builds without pushing, as a proof
        │
        ▼
   publish-develop-smoke-images
   develop pushes only: completes the immutable image
   set for the commit, reusing untouched base images
```

## What each job gates

| Job | Purpose | Typical duration |
| --- | --- | --- |
| `prepare` | Computes the Nx affected graph, the deployable matrix, the guard comparison base, and whether the k3d smoke can be skipped. | 1–2 min |
| `test` | Builds, tests and lints affected projects, and runs every policy guard: workload ownership, agent-domain boundary, mechanical style, module growth, release versioning, Prisma boundaries, config-docs coverage, dependency boundaries. | 3–10 min |
| `database` | Everything PostgreSQL-bound, beside `test` instead of inside it: generates the database client, verifies the reviewed target baseline authority, applies the fresh `target-baseline.sql` to a disposable database, and runs every SQL authority suite. | 2–4 min |
| `api_contract` | Rebuilds the server and proves the OpenAPI reference and generated client are in sync. Runs only when the API contract changed. | skipped, or ~3–5 min |
| `storybook_visual` | Storybook build/behaviour/visual contracts for affected frontend projects, on cached Chromium. Runs beside `test`, not after it. | seconds when nothing affected; ~5 min otherwise |
| `develop_smoke` | Boots a disposable k3d cluster, deploys the full current silo through the real deploy scripts, and proves database isolation, TLS ingress and workload health. | 6–15 min |
| `image_smoke` | Boots individual images that declare an `image-smoke` target and checks they come up. | 1–2 min per image |
| `build-and-push` | Builds every affected deployable image and publishes `sha-<commit>` tags on push events. On pull requests it builds without pushing, as a proof. | 1–5 min warm |
| `publish-develop-smoke-images` | On develop pushes, completes the immutable image set for the commit: reuses the exact validated base image where nothing changed, copies tags forward, builds only what is missing. | seconds per image |

A deploy to a live cluster consumes the published `sha-<commit>` images. CI must be green for the
exact SHA before any deploy — the deploy scripts pull images, never build them (see
[Deploying](/contributing/deploying)).

## Caching layers

Every job runs on a fresh runner, so anything not cached is paid on every run.

| Cache | Backend | Key | Used by |
| --- | --- | --- | --- |
| npm download cache | `actions/setup-node` | lockfile hash | all jobs |
| `node_modules` | `actions/cache` | lockfile hash | all jobs (skips `npm ci` entirely on a hit) |
| Nx computation cache | `actions/cache` (`.nx/cache`) | lockfile hash + commit, with prefix restore | `test`, `api_contract`, `storybook_visual` |
| Playwright Chromium | `actions/cache` (`~/.cache/ms-playwright`) | lockfile hash | `storybook_visual` |
| Docker image layers | registry (`ghcr.io/<owner>/opencrane-buildcache:<project>`) | buildx layer graph | `develop_smoke`, `build-and-push`, `publish-develop-smoke-images` |
| npm inside Dockerfiles | BuildKit cache mount (`/root/.npm`) | shared between build and runtime stages within one build | all Node images |

### Why image layers cache in the registry, not the Actions cache

The repository's 10GB Actions cache quota was permanently over budget — single buildkit blobs
reach ~700MB — so layer caches were evicted almost immediately and every image built cold.
Registry-backed caches (`type=registry`) have no such quota, and moving them out of the Actions
cache also stops the node/Nx caches from being evicted alongside them.

### The layer cache is push-only to write

One registry-backed cache repository exists, and only a `develop`/`main` push may extend it — a
layer produced by unreviewed code never becomes part of a published image:

```text
pull request build (same-repository or fork)
        reads  ← opencrane-buildcache        (trusted: written only by develop/main pushes)
        writes → nothing                     (no cache export on pull requests, forks included)

develop / main push
        reads  ← opencrane-buildcache
        writes → opencrane-buildcache          (mode=max; becomes the new trusted layer set)
```

`opencrane-buildcache` is the only cache image any build reads (`cache-from`), and `cache-to` is
set only on push events. The separate `opencrane-buildcache-pr` cache repository that pull
requests used to export to has been deleted: a pull request build — same-repository or fork — is
now a read-only proof against the last trusted push.

::: info
Chromium binaries restore from the Actions cache; the apt-driven `--with-deps` install runs only
on a cold cache and carries a ten-minute step timeout, because a hung apt once held an untimed
job — and its runner — for hours. Every job in the pipeline has a `timeout-minutes`: a hung job
does not only lose its own time, it occupies a concurrent-runner slot and starves every queued
run behind it.
:::

## The k3d smoke and its skip proof

`develop_smoke` is the pipeline's long pole and its most valuable gate: it exercises the real
deploy path end to end on every develop push. Two mechanisms keep its cost down:

1. **Image reuse by digest.** Projects the affected graph did not select are pulled from the
   validated base commit's published images instead of being rebuilt
   ([`develop-smoke.sh`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh)`:_pull_baseline_image`).
2. **The skip proof.** A pull request skips the k3d smoke entirely when its exact base SHA
   already completed the same k3d job successfully
   ([`scripts/develop-smoke-baseline.mjs`](https://github.com/elewa-git/opencrane/blob/main/scripts/develop-smoke-baseline.mjs)).
   Any ambiguity — API failure, missing proof, affected containers — deliberately runs the
   smoke instead of skipping it.

::: tip
The skip proof is why **keeping develop green is a speed feature**: a red develop push means no
validated base exists, so every subsequent pull request pays the full smoke. A failure streak on
develop taxes every open PR in the repository — fixing develop first is usually the fastest way
to speed up everyone else's work.
:::

The smoke's storage tier also varies: touching `k8s-deploy.sh`, the smoke script, the workflow,
or `apps/postgres/` selects the `full` tier, which additionally exercises CSI volume expansion
(several extra minutes). Other changes run the `fast` tier.
