# Local development tiers

OpenCrane has three development loops. Start with the lowest tier that proves the change, then move
up only when the work crosses that tier's boundary.

| Tier | Use it for | Command | Typical host |
| --- | --- | --- | --- |
| 1 | Routed UI, browser state, components, and deterministic failures | `npm run serve:opencrane-ui` | Any Node development machine |
| 2 | Real API, PostgreSQL persistence, run admission, and local Agent execution | `npm run dev:tier2` | A machine with Docker and 4–6 GB free memory |
| 3 | Helm, Kubernetes identity, NetworkPolicy, migrations, and the full silo | `npm run dev:tier3:infra` or `npm run dev:tier3:agent` | Minimum: 4 cores, 16 GB memory, 32 GB storage; recommended: 8 cores, 32 GB memory, 64 GB storage |

## Tier 1: browser-only frontend

Tier 1 runs onboarding, first chat, conversation work, files, approvals, run progress, and child
Agent threads against one disposable browser lifecycle. It also starts Storybook and its Playwright
visual checks. It does not need PostgreSQL, an API process, Docker, or Kubernetes.

```bash
npm run serve:opencrane-ui
```

Use the named Nx configurations to select a reviewed Commander, Catalyst, Anchor, or Analyst
Guardian path. The [contributor guide](../website/contributing/frontend-development.md) lists the
configurations and deterministic URL scenarios.

## Tier 2: local application

Tier 2 starts PostgreSQL 17, applies the target baseline, seeds a signed local membership, watches
the real server, and runs the UI with live gateways and a fixed local identity.

```bash
npm run dev:tier2
```

The core profile leaves models, memory, files, channels, integrations, Obot, Cognee, and Kubernetes
disabled. Add normal Agent admission and execution with:

```bash
npm run dev:tier2 -- --profile agent --alternative simulated-llm
```

Replace `simulated-llm` with `local-llm` for the pinned local LiteLLM container, or `remote-llm`
with its required HTTPS endpoint and admin-key file. Tier 2 never silently moves between those
credential boundaries.

## Tier 3: full k3d silo

Tier 3 reuses the same current-silo smoke that blocks `develop`. It builds the affected application
images, creates a k3d cluster, installs the pinned cluster controllers, deploys through the app-owned
release script, and proves database isolation, TLS ingress, enabled workloads, and storage. The
coordinator forces `KEEP_CLUSTER=1`, so the qualified cluster remains available for inspection after
the smoke finishes.

Open the repository in its devcontainer, preferably in a GitHub Codespace. The image uses native
Linux amd64 and installs the versions used by the smoke job: Node 24, Helm v4.1.4, k3d v5.8.3, and
kubectl v1.30.10. Docker runs inside the container. The configuration enforces a minimum of 4 cores,
16 GB of memory, and 32 GB of storage so Codespaces can offer smaller machines. The full silo uses
approximately 6 CPUs, 10–12 GB of memory, and 25–30 GB of storage, so 4-core machines may be slower
and the 32-GB disk cannot also hold the complete workspace dependency tree or storage-expansion
driver. Use the recommended 8-core, 32-GB-memory, 64-GB-storage machine for full storage
qualification, repository-wide work, and repeated builds.

Use the credential-free infrastructure profile for chart, workload, storage, login, and routing
qualification. `npm run dev:tier3` remains its short default alias:

```bash
npm run dev:tier3:infra
```

This profile does not read provider keys. The UI and Tier 3 login remain available, but
personal-agent onboarding deliberately cannot publish an Agent revision because the disposable
silo has no default model. Use the provider-backed profile below when complete onboarding or Agent
chat is under test.

Tier 3 protects the minimum disk by using k3d's local-path storage while still deploying every
application workload. It removes an existing root `node_modules` tree, clears the host npm cache and
reusable BuildKit cache, reserves 12 GiB for the imported and later-pulled workload images, imports
local images one at a time, and removes each Docker-side source after k3d accepts it. The workspace
dependencies are reproducible from `package-lock.json`; reinstall them before other repository
work. The direct importer writes no intermediate archive. Keep k3d's default image volume: the
pinned v5.8.3 create path rolls back the cluster when Codespaces disables that volume. On the
recommended 64-GB machine, preserve reusable dependencies and caches, use the faster batch import,
and prove storage expansion:

```bash
SMOKE_HOST_PROFILE=recommended npm run dev:tier3 -- --storage-mode full
```

Every minimum-host rerun starts by resetting the named disposable cluster and its run-owned Docker
image storage, then performs the bounded sequential build-and-import flow again. The preceding
successful cluster remains available for browsing and `kubectl` diagnosis only until that next run;
you do not need to delete it manually first. This clean rebuild trades speed for predictable free
space on a 32-GB disk. Use the recommended profile above when repeated builds should retain the
workspace dependencies and reusable caches.

The contributor command allows 600 seconds for workload readiness unless `TIMEOUT_SECONDS` supplies
another reviewed value.

After qualification, the command listens on `127.0.0.1:4200`. In Codespaces, open the forwarded
port labelled **OpenCrane Tier 3** and keep its visibility private. The local proxy preserves the
browser's `*.app.github.dev` origin while sending the smoke's `.test` host to ingress, so the SPA,
`/api`, `/gateway`, and WebSocket routes all use the real chart routing. Port-forwarding only the
SPA service is not enough: its nginx container deliberately does not proxy application routes.

Click **Login** to establish the installation-selected `Tier 3 Developer` identity; Tier 3 does not
contact an external OpenID Connect provider. The loopback proxy replaces any browser-supplied proof
with a fresh per-run secret, and the server admits the exact fixed identity into the durable
Principal and standalone Owner records before it signs a bounded browser session. The next Tier 3
run rotates both the proxy proof and session key, so sessions from an earlier disposable cluster no
longer authenticate.

### Complete personal-agent onboarding

The agent profile adds one reviewed provider/model to the same full silo and requires it to become
live through LiteLLM before the browser proxy opens:

```bash
npm run dev:tier3:agent -- --provider openai
```

Put the raw upstream key alone in the conventional ignored file; do not add quotes, a variable name,
or JSON. One trailing newline is fine because the coordinator trims it. The file must be a regular,
non-symbolic-link file that no group or other user can read:

```bash
mkdir -p keys
(umask 077 && touch keys/.openai-key)
chmod 600 keys/.openai-key
${EDITOR:-vi} keys/.openai-key
```

The file permissions and `/keys/*` Git ignore rule protect local custody. They do not impose an
upstream spending or request limit: configure those limits in the provider project/account that
issued the key, preferably using a short-lived development key, and rotate or revoke it after
testing.

The profile reuses Tier 2's tracked provider registry. Without options it selects the first
recognised key filename in sorted order and uses that provider's `defaultModel`. `--provider` uses
that provider's default; `--model` selects its owning provider; supplying both requires them to
agree. An explicit model is published as the exact initial routing default rather than being
silently replaced by the production catalogue default.

For a personal Codespace, an account-specific Codespaces secret can avoid keeping the raw key in the
workspace. Scope `OPENCRANE_TIER3_PROVIDER_API_KEY` to only `elewa-git/opencrane`, stop and restart
the Codespace after adding it, then select the non-secret provider:

```bash
npm run dev:tier3:agent -- --provider openai
```

The coordinator rejects an environment key without an explicit provider. It removes the key from
the general smoke environment before image builds and exposes it only to the release installer,
which writes the fixed `byok-provider-key-<provider>` Kubernetes Secret without putting the raw
value in command arguments, Helm values, rendered manifests, generated configuration, or logs.
The server consumes that mounted value once during bootstrap, removes its environment copy, and
blanks the startup snapshot whether provisioning succeeds or fails.
Personal Codespaces secrets are unavailable to prebuilds, so add them only for runtime use. Create
the Codespace from a trusted commit: repository processes in that Codespace can read its runtime
environment.

Adding a model to an existing supported provider requires one reviewed registry change and its
selection tests. Adding a provider also requires the fixed server BYOK provider catalogue, Secret
name, and least-privilege Kubernetes role-based access control (RBAC) to admit it; Tier 3
deliberately does not trade that fixed custody boundary for arbitrary runtime provider names.

The minimum-host command already uses fast local-path storage. Select full storage explicitly when
the change concerns storage expansion:

```bash
npm run dev:tier3 -- --storage-mode full
```

Use `--smoke-only` when a browser is unnecessary. To stop the retained cluster after diagnosis,
run `k3d cluster delete opencrane-develop-smoke`. The command names that one disposable cluster and
does not touch Tier 2 containers or volumes.

## Codespaces prebuilds

The minimum-host devcontainer skips `npm ci` because Tier 3's Node entrypoint uses built-in modules
and every workload installs its own dependencies inside its image build. When at least 40 GB remains
free during creation, the recommended-host profile installs the lockfile-bound workspace dependencies
and can be baked into a Codespaces prebuild. Set
`OPENCRANE_DEVCONTAINER_INSTALL_DEPENDENCIES=1` to force installation for other repository work.
Prebuilds consume Actions minutes and storage. The Docker-in-Docker data volume remains
Codespace-local and is not part of a prebuild.

## Qualification boundary

Tier 3 proves the full disposable silo on k3d. It does not qualify production DNS, public
certificates, cloud workload identity, backup and restore, or an upgrade of a real tenant. Those
remain remote deployment and release evidence under the repository's deploy workflow.

See also: [build, test, and infrastructure guidance](agents/infra.md), [cluster architecture](agents/cluster-architecture.md), and [CI and deploy flow](ci-and-deploy.md).
