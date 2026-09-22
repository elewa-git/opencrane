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
drift between those deployment-owned coordinates and Tier 2. A local Agent profile also creates a
separate `litellm` database owned by a non-privileged `litellm` role with its own persistent credential
inside the worktree-owned PostgreSQL service. Startup waits until LiteLLM can read its model catalogue
and its database-backed virtual-key store, because each Agent turn uses one budget- and lifetime-bound
key. In Codespaces, LiteLLM uses Docker's host network, binds only to `127.0.0.1`, and connects to
PostgreSQL through its loopback-only published port. This keeps the database and model gateway
private while LiteLLM uses the Codespace resolver for external provider lookups. Workstation
launches retain separate containers on the worktree-owned bridge network.

The current release-bound PostgreSQL image and pinned KurrentDB image need an AMD64 Docker daemon.
The pinned LiteLLM tag publishes both architectures, but its ARM64 variant lacks the Prisma schema
engine needed to initialize the virtual-key store. On an ARM64 Docker daemon, `--emulate-amd64`
therefore runs LiteLLM as well as PostgreSQL and KurrentDB through AMD64 emulation. Without that
explicit option, the launcher stops before acquiring containers and explains the two choices below;
changing an operand image would change the current release input, not just this local workflow.

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

The launcher prints the browser address without the session credential:

```text
Tier 2 browser: http://local-development.localhost:4200/
Select "Open current Tier 2 session" when the page loads.
```

The coordinator binds the browser to `http://local-development.localhost:4200`, proxies only
`/api/v1` to the loopback server and seeds one fixed development identity. It prints the safe Tier 2
browser address without its per-launch credential. Open that address and select **Open current Tier
2 session**. That same-origin browser action redirects the current tab through the development-only
handoff, and the Tier 2 build removes the credential fragment from the address bar, retains it in
that browser tab and sends it only to same-origin product API routes. The launcher never writes the
credential or its private fragment URL to terminal output, page text or a general API response.

An independently opened fresh tab still needs the button because the credential is kept in browser
session storage rather than durable shared storage. A same-origin tab created with an opener can
inherit a copy of that storage. An old tab cannot authenticate a later launch. On a workstation, the
browser uses `local-development.localhost`; in Codespaces, it uses the one private HTTPS
port-forwarding host described below. The server does not mount the production Kubernetes workload
listener or accept a non-loopback PostgreSQL server.

Use an Agent profile when the change needs one current Conversation Computer:

```bash
# On a workstation, uses the configured default or the first recognized keys/.<provider>-key file.
npm run dev:tier2:agent

# Selects one provider and optional reviewed model explicitly.
npm run dev:tier2:agent:local-llm -- --provider openai --model openai/gpt-5.5

# Persists openai as this workstation's fallback for later plain launches.
npm run dev:tier2:agent:local-llm -- --default-provider openai

# Uses an existing HTTPS LiteLLM gateway and an owner-only administrator-key file.
npm run dev:tier2:agent:remote-llm -- \
  --remote-litellm-endpoint https://litellm.example.com \
  --remote-litellm-master-key-file /absolute/path/to/admin-key

# Uses the deterministic model transport and reads no provider credential.
npm run dev:tier2:agent:simulated-llm
```

### Run Tier 2 in Codespaces or on ARM

Use an AMD64 Codespace with at least 2 cores and 8 GB of memory for Tier 2. When creating the
Codespace, choose the `OpenCrane Tier 2` configuration at
`.devcontainer/tier2/devcontainer.json`. That
configuration installs Docker-in-Docker and the Tier 2 command-line tools, runs `npm ci`, and
forwards only browser port 4200.

The reviewed providers are:

- `anthropic`
- `deepseek`
- `gemini`
- `glm`
- `mistral`
- `openai`

For real model calls through the local LiteLLM profile, create one or more personal Codespaces
development secrets from these names and grant them access only to this repository:

```text
ANTHROPIC_TIER2_PROVIDER_API_KEY
DEEPSEEK_TIER2_PROVIDER_API_KEY
GEMINI_TIER2_PROVIDER_API_KEY
GLM_TIER2_PROVIDER_API_KEY
MISTRAL_TIER2_PROVIDER_API_KEY
OPENAI_TIER2_PROVIDER_API_KEY
```

The provider part is uppercase with no spaces. Stop and restart an existing Codespace after adding
or changing a secret. The tracked devcontainer configuration recommends these names but never
contains their values.

::: warning Rename the earlier generic secret
`OPENCRANE_TIER2_PROVIDER_API_KEY` is no longer accepted because its name cannot prove which
provider owns its value. Replace it with the matching uppercase provider-specific secret before
restarting the Codespace.
:::

An explicit provider selects its matching secret:

```bash
npm run dev:tier2:agent:local-llm -- --provider openai --model openai/gpt-5.5
```

When neither `--provider` nor `--model` selects a provider, Codespaces checks
`--default-provider` first, then `OPENCRANE_TIER2_DEFAULT_PROVIDER`, then the alphabetically first
configured provider secret. `--default-provider` sets the custom environment variable for the
current coordinator. The launcher cannot modify its parent shell or a GitHub account setting. To
retain this nonsecret preference, add a lowercase value to the Codespace's `~/.bashrc` or personal
dotfiles:

```bash
export OPENCRANE_TIER2_DEFAULT_PROVIDER=openai
```

You can then use the plain command:

```bash
npm run dev:tier2:agent:local-llm
```

The coordinator removes every matching provider credential from its worker environment before
validation starts child commands. It supplies only the selected value to the Docker invocation that
starts loopback LiteLLM; validation and application children do not inherit the provider secrets.
Generated configuration and Docker arguments contain only the internal environment-variable
reference. A missing or empty matching secret, unreviewed provider, variable or model, and a
cross-provider model selection all stop before Docker resources are acquired.

Codespaces gives LiteLLM a 120-second startup budget; a workstation keeps a 30-second budget. The
launcher reserves the final two seconds for failure diagnostics. In Codespaces, LiteLLM can exit
when its embedded Prisma query engine cannot accept database requests. The container adds
loopback addresses to uppercase and lowercase proxy-exclusion settings so database traffic stays
on the Codespace. The launcher recognises both observed traceback forms for that failure and
restarts the same container. Uvicorn can report application startup failure while the image's process keeps Docker's
container state running. The launcher therefore checks current-start logs every two seconds and
restarts that state only when it contains both the Prisma evidence and the explicit application
failure marker. Both recovery paths share a limit of two restarts within the startup budget. Other
exits are not restarted. An early exit or timeout includes the latest Docker state and, when Docker
returns it before the deadline, a bounded startup-log tail. Provider, master-key and
database-password values are removed, and the container
environment is never printed. Check the
Architecture line in `docker info` reports `amd64` or `x86_64`, then run the core, simulated-Agent
or credential-backed Agent command without an emulation flag.

The pinned LiteLLM image carries the OpenAI tokenizer cache used during startup. The launcher points
LiteLLM at that bundled cache, so Codespaces does not need to resolve or contact
`openaipublic.blob.core.windows.net` before the proxy can become ready.

Keep the forwarded 4200 port **private** in the Codespaces Ports view. The launcher derives one
HTTPS browser address from the Codespace's forwarding variables and prints it without the
per-launch credential. Open that address after GitHub authenticates access to the private port, then
select **Open current Tier 2 session**. The UI accepts only that Codespace hostname, and the server
rejects other forwarded hosts or state-changing origins. Do not make the port public to work around
a browser or proxy error; neither the backend nor the database/model ports should be forwarded.

On an ARM64 workstation, opt in to Docker's AMD64 emulation instead:

```bash
npm run dev:tier2 -- --emulate-amd64
# Or keep the selected Agent alternative:
npm run dev:tier2:agent:simulated-llm -- --emulate-amd64
```

On Apple Silicon this needs Docker Desktop with AMD64 emulation available; an ARM Linux Docker
Engine needs compatible QEMU/binfmt support. Emulation can make image pulls, builds and startup
much slower, and some builds or containers can fail. This is a best-effort local option, not the
qualified path for deployment or Codespaces. `--emulate-amd64` affects the pinned PostgreSQL,
KurrentDB and local LiteLLM containers plus the short-lived PostgreSQL permission and KurrentDB TLS
helpers. It changes only Docker's selected platform; the release manifest and pinned immutable image
digests remain unchanged. Prefer an AMD64 Codespace when emulation is unreliable. Do not use
`--reset` for an architecture mismatch: it deletes local database data but cannot change image support.

Outside Codespaces, local provider keys are owner-only regular files named `keys/.openai-key`,
`keys/.anthropic-key`, `keys/.gemini-key`, `keys/.mistral-key`, `keys/.deepseek-key` or
`keys/.glm-key`. They must not be symbolic links. The local LiteLLM configuration contains an
environment-variable reference, never the key value. `--default-provider openai` chooses
`keys/.openai-key`, updates the current worker's `OPENCRANE_TIER2_DEFAULT_PROVIDER` value and writes
the same assignment to the ignored, owner-only `keys/.tier2-default-provider.env` file. Later plain
launches load it automatically, including after `--reset`. An explicitly exported
`OPENCRANE_TIER2_DEFAULT_PROVIDER` overrides the stored preference without rewriting it. An explicit
`--provider` or `--model` still wins. The launcher does not modify the parent shell.
Codespaces does not read these checkout files and instead uses the uppercase provider-specific
variables listed above. Remote mode accepts only an HTTPS origin and an explicit owner-only
administrator-key file; it refuses a local provider-key path.

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

After the command reports that Tier 2 has stopped, close the browser tab or tabs opened for that
launch before restarting it. The launcher cannot close browser windows on your behalf. Closing the
tabs ends their page sessions, so they cannot reuse the previous launch's browser credential after
the next command creates a new one.

Only one Tier 2 command can own a repository worktree at a time. If another core or Agent command is
already running, a second invocation prints a warning and exits before it inspects, removes or starts
any Docker resource. Continue using the existing terminal, or stop it and wait for its cleanup and
browser-tab reminder before starting another profile.

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
is not already present. The coordinator stops on a CPU, memory or total-storage shortfall without
deleting dependency caches, clusters, images or other developer state.

After that admission check, the default minimum-host qualification bounds Docker storage before it
builds the silo. It removes the reproducible root `node_modules` tree, clears the user-wide npm
package cache, prunes unused data from the active shared BuildKit builder towards 13 GiB free, prunes
daemon-wide dangling images and requires at least 12 GiB free on Docker's backing filesystem. These
cache operations can affect other checkouts that use the same account or Docker daemon. After
building, it imports the five tag-based service images separately, publishes the two digest-selected
images to the owned loopback registry, releases each accepted local source tag, clears completed
BuildKit cache and checks the 12 GiB deployment reserve again. This prevents a minimum Codespace from
entering Kubernetes `DiskPressure` during deployment. Reinstall dependencies after the qualification
if you need host-side Nx, lint or test commands.

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

`SMOKE_HOST_PROFILE=recommended` preserves reusable dependencies, images and build cache on a larger
development or CI host. `--smoke-only` completes the cluster qualification and returns without
keeping the browser proxy open.

For the Agent profile on a workstation, place one supported provider key in an owner-only ordinary
file. The file must use an absolute path and must not be a symbolic link:

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

In Codespaces, configure one or more provider-specific development secrets:

```text
ANTHROPIC_TIER3_PROVIDER_API_KEY
DEEPSEEK_TIER3_PROVIDER_API_KEY
GEMINI_TIER3_PROVIDER_API_KEY
GLM_TIER3_PROVIDER_API_KEY
MISTRAL_TIER3_PROVIDER_API_KEY
OPENAI_TIER3_PROVIDER_API_KEY
```

Run `npm run dev:tier3:agent` to use the alphabetically first configured provider. An explicit
`--provider` wins. Otherwise `--default-provider`, then a manually exported
`OPENCRANE_TIER3_DEFAULT_PROVIDER`, selects the matching secret. The flag sets the custom
environment variable for the current coordinator. To retain the nonsecret preference for later
Codespaces launches, export it from `~/.bashrc` or personal dotfiles:

```bash
export OPENCRANE_TIER3_DEFAULT_PROVIDER=openai
```

The coordinator consumes only the selected key in memory and removes every matching Tier 3
provider-secret variable before it measures capacity or starts smoke, Docker, Helm or application
child processes. Codespaces refuses `--provider-key-file`; workstations retain the owner-only file
contract.

After infrastructure qualification, the command prints a loopback browser URL. In GitHub
Codespaces, keep the forwarded port **private**. The proxy pins the certificate named by the live
Kubernetes `Certificate`, preserves the exact `.test` ingress authority and accepts only the
launcher's loopback browser address or its exact Codespaces forwarded address. Unknown browser
addresses are rejected even for reads; state changes require the matching browser origin, and
WebSocket upgrades require an `Origin` header. Codespaces may rewrite same-origin subresource and
API request origins to its HTTPS loopback address. The proxy accepts that rewrite only when the
forwarded authority is the launcher's exact private address, the Referer names that address and the
browser reports a same-origin fetch. After admission, the proxy normalises present browser Origin
and Referer headers to the certificate-pinned ingress origin before forwarding them. The per-launch
development identity is available only in this explicit standalone k3d profile; ordinary releases
remain OpenID Connect (OIDC)-only.

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
