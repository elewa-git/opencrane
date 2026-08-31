# Build, test, and infrastructure

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Build and test

The workspace uses npm workspaces and Nx.

- Install dependencies: `npm ci`
- Build all projects: `npm run build`
- Test all projects: `npm run test`
- Run one project: `npx nx run <project>:<target>`
- Check affected projects: `npx nx affected -t build test lint --base=origin/main`
- Check dependency boundaries: `npm run lint:boundaries`

Use focused project tasks while editing and the affected graph at a slice gate. Helm or deployment
changes also require the matching contract scripts under `apps/*/tests` or
`apps/_infra/deploy-k8s/platform/tests`.

### Remote heavyweight validation

Container-backed validation runs on GitHub Actions, not in a VM created on a developer workstation.
Agents must never create, start, or restart Colima, Lima, Docker Desktop, Rancher Desktop, or another
local VM-backed container runtime for repository validation unless the user explicitly requests that
local runtime in the current task.

- Keep focused validation that does not require a container runtime local.
- Push the exact scoped commit and use the affected workflow for Docker image smokes, PostgreSQL
  baseline and authority suites, Storybook browser contracts, and k3d qualification.
- Use the workflow's `heavy_qualification` dispatch input when an image smoke, k3d smoke, or both must
  run even though the affected graph would not select them.
- Bind reported evidence to the tested commit SHA and Actions run URL. A local Docker result is not a
  substitute for the required remote job.

If a required container-backed target has no Actions owner, wire it into the affected workflow before
treating the target as a completion gate. Do not fill that CI gap by starting a local VM.

Read [`versioning.md`](./versioning.md) before changing a chart or deploy path. Pre-1.0 a chart
change needs no version stamp or transition record; only a database baseline change must update the
digest in the current release manifest.

## Infrastructure layout

| Path | What it owns |
| --- | --- |
| `apps/*/helm/` | The deployment contract for that app's workloads. |
| `apps/_infra/{cognee,litellm,obot}/` | Pinned third-party workload wrappers. |
| `apps/_infra/deploy-k8s/` | The organisation umbrella chart and deploy entrypoint. |
| `apps/_infra/deploy-k8s/platform/` | Shared Helm helpers, deploy engine, values profiles, Terraform, and platform contract tests. |
| `apps/postgres/` | OpenCrane-owned CloudNativePG deployment and clean database bootstrap. |

Every independently deployed workload has one app owner. Reusable application behaviour belongs in
`libs/*`; deployment scripts and templates do not become business-domain authorities.

## Deployment

`apps/_infra/deploy-k8s/deploy.sh` installs one ClusterTenant organisation boundary. It delegates to
`platform/k8s-deploy.sh`, which renders and applies the composed app-owned chart.

Values profiles live under `apps/_infra/deploy-k8s/platform/values/`. Put repeatable environment
configuration in a profile, not in an undocumented one-off flag.

The deploy path requires the cluster-wide ingress, certificate, DNS, and CloudNativePG controllers.
It does not install those controllers as part of an organisation release.

## Terraform and Helm

- Terraform owns cloud infrastructure, cloud identities, and trust bindings.
- Helm owns Kubernetes workloads, service accounts, roles, NetworkPolicies, storage declarations,
  and application configuration.
- Application code consumes those identities and credentials through explicit ports; it does not
  create a parallel access scheme.

## Validation

For infrastructure changes:

1. render the exact values profile being changed;
2. run its Helm contract tests;
3. run `helm lint` for the owning chart;
4. run `git diff --check`;
5. run `npm run check:release-versioning`;
6. use the repository deploy or teardown script for live mutations; and
7. record live deployment evidence in [`deploy-ledger.md`](./deploy-ledger.md).

See [`k8s.md`](./k8s.md) for service-account, RBAC, route, and NetworkPolicy requirements.
