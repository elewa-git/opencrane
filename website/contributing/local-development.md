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

The PostgreSQL image starts as an unprivileged user. Before starting it, the coordinator checks that
the named data volume belongs to this repository worktree and target baseline. A short, network-disabled
helper from the same pinned image then gives **only the volume's top directory** to that user and
restricts its permissions. The database still runs unprivileged; the helper does not rewrite stored
files or clear data. If Docker refuses that ownership change, startup fails and preserves the volume.
The process gets a separate, temporary socket directory owned by the image's UID 26; it does not
store database data there. Do not use `--reset` for a volume-permission error: it deletes data
without fixing the Docker host.

Start the core application profile:

```bash
npm run dev:tier2
```

The coordinator binds the browser to `http://local-development.localhost:4200`, proxies only
`/api/v1` to the loopback server and seeds one fixed development identity. It prints a private URL
with a new browser-session credential on every launch. Open that exact URL: the Tier 2 build removes
the credential from the address bar, retains it in that browser tab, and sends it only to same-origin
product API routes. If you first open the plain Tier 2 address in a fresh tab, the frontend shows
**Open the private URL printed by the Tier 2 launcher** instead of sending you to a backend JSON
error. Return to the running terminal and open its complete private URL in that tab. The plain
address then loads the normal application in the same tab. An independently opened fresh tab still
needs the private URL because the credential is kept in browser session storage rather than durable
shared storage. A same-origin tab created with an opener can inherit a copy of that storage. An old
tab cannot authenticate a later launch.
On a workstation, the browser
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
or the LiteLLM image. The short PostgreSQL volume helper uses the same pinned image and therefore
also runs under emulation. Prefer an AMD64 Codespace when emulation is unreliable. Do not use `--reset`
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

::: info Conversation files need the full silo
Tier 2 does not start the private ArtifactStore service or file scanner, and it does not mount the
keys used to authorise file bytes. Conversation-file upload, download and listing routes are
unavailable in Tier 2; the personal asset metadata catalogue remains available. Use Tier 3 to test
file storage and scanning against the current deployment rather than supplying a made-up local
ArtifactStore URL or keys. Tier 2's live OpenAPI document omits these file routes; the production
document and generated client still describe the full silo.
:::

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

Tier 3 is being rebuilt as the child of Tier 2. Until its successor pull request lands, do not treat
the closed historical branch as a supported setup path.

| Profile | Intended boundary | Status |
| --- | --- | --- |
| Tier 3 infra | `npm run dev:tier3` or `npm run dev:tier3:infra` — current silo and prerequisites in disposable k3d, including Codespaces browser routing | 🔶 Rebuild planned |
| Tier 3 agent | `npm run dev:tier3:agent` — infra plus one governed provider setup and one Agent Sandbox conversation turn | 🔶 Rebuild planned |

Tier 3 retains the historical minimum target of 4 cores, 16 GB memory and 32 GB storage, with 8
cores, 32 GB memory and 64 GB storage recommended. A minimum-host run must report a storage
shortfall instead of deleting unrelated dependency caches, clusters or other developer state.
