# Contributing to OpenCrane

This section is for people changing the **OpenCrane codebase itself**: what happens between
opening a pull request and a change running on a live cluster, and how to work with that
pipeline instead of against it.

> See also: [Cluster deployment](/guide/deploy-cluster) (the operator-facing install path this
> pipeline publishes images for) and [Hosting and deployment](/operators/hosting) (what a
> release owns once it is live).

## The journey from pull request to running cluster

A change passes through the same three stages whether it is a one-line fix or a new subsystem:

```text
pull request opened
        │
        ▼
   CI pipeline runs          three workflows validate the change;
   (see: The CI pipeline)    the longest is the k3d silo smoke
        │
        ▼
   merge to develop or main
        │
        ▼
   images published          sha-<commit> tags, immutable, never floating
        │
        ▼
   deploy scripts run         apps/_infra/deploy-k8s/deploy.sh → k8s-deploy.sh
   (see: Deploying)           pulls the exact published images, never builds them
        │
        ▼
   live cluster, verified     post-deploy-verify.sh checks real health
```

Two threads run underneath every step of that journey:

- **Versioning.** Every directly changed application, chart and database schema stamps forward
  together, and CI enforces the whole scheme before anything reaches the deploy path — see
  [Versions and migrations](/contributing/versions-and-migrations).
- **Automation.** The same deploy scripts an operator would run by hand are scriptable enough
  for an agent to run, verify and triage — see
  [Letting an AI agent manage your deployment](/contributing/ai-managed-deployment).

## In this section

| Page | Covers |
| --- | --- |
| [Frontend development](/contributing/frontend-development) | The backend-free Tier 1 UI profile, deterministic scenarios, gateway-extension pattern, Storybook, and the explicit live-backend configuration |
| [The CI pipeline](/contributing/ci-pipeline) | The three workflows, what each `docker.yml` job gates, and the caching layers that keep it fast |
| [Deploying](/contributing/deploying) | The script-only rule, the deploy chain, bootstrap prerequisites, and the warnings that save hours |
| [Versions and migrations](/contributing/versions-and-migrations) | The repository train, the stamp rule, chart and database migrations, and how CI enforces them |
| [Letting an AI agent manage your deployment](/contributing/ai-managed-deployment) | The gitignored `keys/` convention, credential custody, and the deploy agent + `/deploy-loop` skill |

::: tip
Keeping the `develop` branch green is the single highest-leverage thing a contributor can do:
a red `develop` means every open pull request pays the full k3d smoke instead of skipping it.
See [the skip proof](/contributing/ci-pipeline#the-k3d-smoke-and-its-skip-proof).
:::

Source: [`docs/ci-and-deploy.md`](https://github.com/elewa-git/opencrane/blob/main/docs/ci-and-deploy.md)
is the deeper repository-side reference this section publishes from.
