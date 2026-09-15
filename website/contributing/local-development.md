# Local development

Use the local-development tiers to choose the smallest OpenCrane environment that can prove the
change you are making. Tier 1 runs the browser application without a backend; later tiers add the
current local server and then a disposable Kubernetes cluster.

> See also: [Contributing overview](/contributing/overview) (the complete change journey),
> [The CI pipeline](/contributing/ci-pipeline) (what the pull request will run), and
> [Deploying](/contributing/deploying) (the script-only cluster path).

## Tier 1 — frontend-only work

Tier 1 serves the real OpenCrane Angular application over one disposable in-memory profile. The same
command starts Storybook against the reviewed mocks and runs the Playwright visual pass against that
catalogue. It uses the current onboarding and conversation components, but it makes no application
API request and needs no PostgreSQL, KurrentDB, Docker, model provider, Cognee, Agent Sandbox or
Kubernetes installation.

Start the complete onboarding journey:

```bash
npm run serve:opencrane-ui
```

Open the routed application at `http://localhost:4200` and the interactive Storybook catalogue at
`http://127.0.0.1:4400`. Playwright uses a separate static Storybook workbench on port `4401`, checks
the tagged visual contracts once, and exits; the application and interactive catalogue remain ready
until you stop the command.

The plain command always opens onboarding with Commander as its deterministic initial fixture. The
reviewed survey result becomes the personal-Agent archetype used by first chat and the workspace.

To open an existing reviewed archetype's personal-Agent conversation directly, use one of these
commands:

```bash
npm run serve:opencrane-ui:commander
npm run serve:opencrane-ui:catalyst
npm run serve:opencrane-ui:anchor
npm run serve:opencrane-ui:analyst
```

Those are the complete supported archetype set. A named command selects one for that run; it does
not persist a hidden preference, create a new archetype, or change the next plain command's
onboarding entry point.

The local profile supports finite, repeatable scenarios through the `mockScenario` query parameter:

| Scenario | What it helps test |
| --- | --- |
| `happy-path` | Normal onboarding and conversation work |
| `slow` | Busy and loading presentation |
| `retry` | One recoverable command failure followed by success |
| `reconnecting` | Conversation stream reconnection |
| `failed-run` | A saved failed-work projection without obsolete runtime controls |
| `access-changed` | Fail-closed removal of content after access changes |

For example, open `/onboarding?mockScenario=reconnecting` on the served origin. An unknown scenario
uses the documented happy path; an unknown archetype is rejected rather than invented.

## Recover an outdated Angular dependency cache

Changing branches or resetting a pull-request stack does not normally require clearing Angular or
Nx caches. First stop the existing development server and run the appropriate command again.

Only clear the frontend caches when the browser or terminal reports `504 (Outdated Optimize Dep)`
or `Failed to fetch dynamically imported module` for an Angular development chunk:

```bash
rm -rf .angular/cache
npm exec nx reset
npm run serve:opencrane-ui
```

This recovery removes generated frontend cache data; it does not remove application data or rebuild
a database. A hard browser refresh is useful after the new server is ready, but repeated refreshes
cannot repair an outdated optimiser cache by themselves.

::: warning Do not use cache deletion as a routine branch switch
Nx and Angular caches make normal development faster. Clear them only for the optimiser failure
above, not whenever a branch changes and not as a substitute for reading the first server error.
:::

## Tier 2 — local application work

Tier 2 runs the current server and live-gateway browser application on a workstation or an AMD64
Codespace. It uses
Docker for a clean-baseline PostgreSQL database and TLS KurrentDB; Agent profiles can also run a
loopback LiteLLM container. Install the repository dependencies and make sure `docker`, `openssl`,
`curl` and `jq` are available before starting it. On macOS or Windows, install and start Docker
Desktop. On Linux, use a compatible Docker Engine with a working Docker CLI and socket. Verify the
container runtime is ready with `docker info` before starting Tier 2.

The coordinator pins the same KurrentDB operand used by the current develop-smoke profile. Local
LiteLLM resolves the deployment-owned repository and reviewed tag to an immutable multi-platform
digest, so a later vendor tag update cannot change an existing Tier 2 branch silently. CI rejects
drift between those deployment-owned coordinates and Tier 2.

The current release-bound PostgreSQL image and pinned KurrentDB image need an AMD64 Docker daemon.
The pinned LiteLLM image is multi-platform and is not forced through AMD64 emulation. On an ARM64
Docker daemon the launcher stops before acquiring containers and explains the two choices below;
changing the database image would change the current release operand, not just this local workflow.

Start the core application profile:

```bash
npm run dev:tier2
```

The coordinator binds the browser to `http://local-development.localhost:4200`, proxies only
`/api/v1` to the loopback server and seeds one fixed development identity. It prints a private URL
with a new browser-session credential on every launch. Open that exact URL: the Tier 2 build removes
the credential from the address bar, retains it in that browser tab, and sends it only to same-origin
product API routes. An old tab cannot authenticate a later launch. On a workstation, the browser
uses `local-development.localhost`; in Codespaces, it uses the one private HTTPS port-forwarding
host described below. The server does not mount the
production Kubernetes workload listener or accept a non-loopback PostgreSQL server.

Use an Agent profile when the change needs one current Conversation Computer:

```bash
# Uses local LiteLLM and the first recognized keys/.<provider>-key file in lexical order.
npm run dev:tier2:agent

# Makes the local model path explicit; --provider and --model are optional.
npm run dev:tier2:agent:local-llm -- --provider openai --model openai/gpt-5.5

# Uses an existing HTTPS LiteLLM gateway and an owner-only administrator-key file.
npm run dev:tier2:agent:remote-llm -- \
  --remote-litellm-endpoint https://litellm.example.com \
  --remote-litellm-master-key-file /absolute/path/to/admin-key

# Uses the deterministic model transport and reads no provider credential.
npm run dev:tier2:agent:simulated-llm
```

### Run Tier 2 in Codespaces or on ARM

[Issue #684](https://github.com/elewa-git/opencrane/issues/684) calls for a 2-core, 8 GB Codespace
for Tier 2. When creating the Codespace, choose the `OpenCrane Tier 2` configuration at
`.devcontainer/tier2/devcontainer.json` and an AMD64 machine with at least those resources. That
configuration installs Docker-in-Docker and the Tier 2 command-line tools, runs `npm ci`, and
forwards only browser port 4200. Check the Architecture line in `docker info` reports `amd64`
or `x86_64`, then run the same core or Agent command above without an emulation flag.

Keep the forwarded 4200 port **private** in the Codespaces Ports view. The launcher derives one
HTTPS browser URL from the Codespace's forwarding variables and prints a fresh per-launch credential
in it. Open that exact URL after GitHub authenticates access to the private port. The UI accepts
only that Codespace hostname, and the server rejects other forwarded hosts or state-changing
origins. Do not make the port public to work around a browser or proxy error; neither the backend
nor the database/model ports should be forwarded.

On an ARM64 workstation, opt in to Docker's AMD64 emulation instead:

```bash
npm run dev:tier2 -- --emulate-amd64
# Or keep the selected Agent alternative:
npm run dev:tier2:agent:simulated-llm -- --emulate-amd64
```

On Apple Silicon this needs Docker Desktop with AMD64 emulation available; an ARM Linux Docker
Engine needs compatible QEMU/binfmt support. Emulation can make image pulls, builds and startup
much slower, and some builds or containers can fail. This is a best-effort local option, not the
qualified path for deployment or Codespaces. `--emulate-amd64` affects only the pinned PostgreSQL
and KurrentDB containers and the KurrentDB TLS provisioner; it does not change the release manifest
or the LiteLLM image. Prefer an AMD64 Codespace when emulation is unreliable. Do not use `--reset`
for an architecture mismatch: it deletes local database data but cannot change image support.

Local provider keys are owner-only regular files named `keys/.openai-key`,
`keys/.anthropic-key`, `keys/.gemini-key`, `keys/.mistral-key`, `keys/.deepseek-key` or
`keys/.glm-key`. They must not be symbolic links. The local LiteLLM configuration contains an
environment-variable reference, never the key value. Remote mode accepts only an HTTPS origin and
an explicit owner-only administrator-key file; it refuses a local provider-key path.

The workstation-hosted Conversation Computer is a development realization, not an Agent Sandbox.
It binds only to loopback, is fenced to the current lease and does not advertise Kubernetes,
gVisor, browser/CDP, review-command or durable workspace-checkpoint capabilities. Use Tier 3 to
prove those deployment boundaries.

### Stop or reset Tier 2

Interrupting, terminating or suspending the command stops the processes and removes only the
PostgreSQL, KurrentDB and optional LiteLLM containers, Docker network, KurrentDB TLS volume, browser
credential and other session secrets owned by that repository worktree. The paired PostgreSQL and
KurrentDB data volumes remain for the next launch. Their database credentials and conversation
payload keyring remain owner-only on disk so the retained data stays readable. Failed startup uses
the same cleanup path.

Codespaces VM stop or suspension may not deliver a shutdown signal to the launcher. The platform
may preserve or reclaim its Docker-in-Docker state; on the next run the launcher removes stale
containers owned by the same worktree. Do not rely on a Codespace suspension as a guaranteed
resource-cleanup event.

The repository uses the 0.11 fresh-install baseline. If the launcher reports that the persistent
database uses a different target baseline, recreate both persistent stores together:

```bash
npm run dev:tier2 -- --reset
# Or retain the selected Agent profile:
npm run dev:tier2:agent -- --reset
```

`--reset` permanently removes that worktree's local PostgreSQL and KurrentDB data plus the credentials
and conversation keyring paired with those stores. It then creates new credentials, reapplies the
reviewed target baseline and development seed, and starts the selected profile. It is not an upgrade
or migration. The launcher refuses to reset similarly named resources owned by another repository
or worktree.

Do not restore the retired release-transition command, warm runtime, channel proxy or Obot paths
from git history. Also do not clear Angular or Nx caches as part of a database reset. Use the cache
recovery steps above only when the optimiser reports `504 (Outdated Optimize Dep)` or the matching
dynamic-import failure.

## Tier 3 — k3d and Codespaces

Tier 3 installs the current silo and its prerequisites into a k3d cluster owned by the exact Git
worktree. It uses the same PostgreSQL target baseline, KurrentDB history, Cognee memory service,
LiteLLM model gateway and Agent Sandbox contracts as the current deployment path. It does not
restore a 0.10 upgrade path or a retired runtime.

| Profile | Intended boundary | Status |
| --- | --- | --- |
| Tier 3 infra | Current silo and prerequisites in owned k3d, including private Codespaces browser routing | Implemented; live host qualification remains required |
| Tier 3 agent | Infra plus governed provider setup, onboarding and one real Agent Sandbox conversation turn | Implemented; live host qualification and a provider key remain required |

The checked-in development container pins Node.js 24, Docker 28.5.1, Helm 4.1.4, k3d 5.8.3 and
kubectl 1.30.10 on both amd64 and arm64 Codespaces. A local workstation can use its own compatible
tools. Tier 3 requires at least 4 cores, 16 GB memory and 32 GB total storage; 8 cores, 32 GB memory
and 64 GB storage are recommended.
The command measures total and available space on Docker's backing filesystem, where k3d stores its
nodes and images; it does not substitute the checkout filesystem when Docker Desktop uses a separate
VM disk. It displays measurements in GiB but compares them with the decimal-GB requirements above;
for example, a reported 15.6 GiB of memory and 31.3 GiB of total storage meet the minimum.
Available space is reported for diagnosis. A lightweight BusyBox probe image may be pulled when it
is not already present. The command stops on a minimum shortfall without deleting dependency caches,
clusters, images or other developer state.

Start the credential-free infrastructure profile:

```bash
npm run dev:tier3
# The explicit equivalent:
npm run dev:tier3:infra
```

The default `fast` storage mode uses disposable local-path storage. Use the full expandable-storage
qualification when changing storage-sensitive code:

```bash
SMOKE_HOST_PROFILE=recommended npm run dev:tier3:infra -- --storage-mode full
```

`SMOKE_HOST_PROFILE=recommended` asks the underlying qualification to enforce the recommended host
capacity instead of accepting the minimum. `--smoke-only` completes the cluster qualification and
returns without keeping the browser proxy open.

For the Agent profile, place one supported provider key in an owner-only ordinary file. The file
must use an absolute path and must not be a symbolic link:

```bash
chmod 600 /absolute/path/to/openai-key
npm run dev:tier3:agent -- \
  --provider openai \
  --provider-key-file /absolute/path/to/openai-key
```

Supported providers are `openai`, `anthropic`, `gemini`, `mistral`, `deepseek` and `glm`. The
coordinator sends the key only through the current bring-your-own-key (BYOK) product authority; it
does not put it into Helm values or print it. The proof completes the current persona survey and
guided onboarding, creates the published personal Agent, submits one message and waits for the
correlated provider-backed response from a current Agent Sandbox run. A deterministic or simulated
model response is not accepted as Tier 3 Agent proof.

After infrastructure qualification, the command prints a loopback browser URL. In GitHub
Codespaces, keep the forwarded port **private**. The proxy pins the certificate named by the live
Kubernetes `Certificate`, preserves the exact `.test` ingress authority and accepts only the
launcher's loopback browser address or its exact Codespaces forwarded address. Unknown browser
addresses are rejected even for reads; state changes require the matching browser origin, and
WebSocket upgrades require an `Origin` header. The per-launch development identity is available
only in this explicit standalone k3d profile; ordinary releases remain OpenID Connect (OIDC)-only.

Each worktree derives its own cluster, namespace, release, registry, ingress port and owner label.
If a previous run retained those exact owned resources, choose explicitly between replacing them
and inspecting them:

```bash
npm run dev:tier3:infra -- --replace-owned
npm run dev:tier3:down
```

`--replace-owned` refuses a similarly named cluster with a missing or different owner label.
`dev:tier3:down` checks the complete k3d node and image-volume set before deleting the exact
owned cluster and associated registry. It then removes only that worktree's smoke image references
and layers. If an orphan or foreign resource cannot be proved owned, cleanup stops and leaves it in
place for inspection. Changing the 0.11 database baseline means rebuilding this disposable
environment; there is no pre-1.0 migration or backwards-compatibility route between stale and
current Tier 3 data.
