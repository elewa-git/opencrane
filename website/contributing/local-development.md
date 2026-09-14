# Local development

Use the local-development tiers to choose the smallest OpenCrane environment that can prove the
change you are making. Tier 1 runs the browser application without a backend; later tiers add the
current local server and then a disposable Kubernetes cluster.

> See also: [Contributing overview](/contributing/overview) (the complete change journey),
> [The CI pipeline](/contributing/ci-pipeline) (what the pull request will run), and
> [Deploying](/contributing/deploying) (the script-only cluster path).

## Tier 1 — frontend-only work

Tier 1 serves the real OpenCrane Angular application over one disposable in-memory profile. It
uses the current onboarding and conversation components, but it makes no application API request and needs no
PostgreSQL, KurrentDB, Docker, model provider, Cognee, Agent Sandbox or Kubernetes installation.

Start the complete onboarding journey:

```bash
npm run serve:opencrane-ui
```

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

Tier 2 runs the current server and live-gateway browser application on the workstation. It uses
Docker for a clean-baseline PostgreSQL database and TLS KurrentDB; Agent profiles can also run a
loopback LiteLLM container. Install the repository dependencies and make sure `docker`, `openssl`,
`curl` and `jq` are available before starting it.

The coordinator pins the same KurrentDB operand used by the current develop-smoke profile. Local
LiteLLM resolves the deployment-owned repository and reviewed tag to an immutable multi-platform
digest, so a later vendor tag update cannot change an existing Tier 2 branch silently. CI rejects
drift between those deployment-owned coordinates and Tier 2.

Start the core application profile:

```bash
npm run dev:tier2
```

The coordinator binds the browser to `http://local-development.localhost:4200`, proxies only
`/api/v1` to the loopback server and seeds one fixed development identity. It prints a private URL
with a new browser-session credential on every launch. Open that exact URL: the Tier 2 build removes
the credential from the address bar, retains it in that browser tab, and sends it only to same-origin
product API routes. An old tab cannot authenticate a later launch. The server does not mount the
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
| Tier 3 infra | Current silo and prerequisites in owned k3d, including private Codespaces browser routing | ✅ Ready for review; live host qualification remains required |
| Tier 3 agent | Infra plus governed provider setup, onboarding and one real Agent Sandbox conversation turn | ✅ Ready for review; requires a provider key |

The checked-in development container pins Node.js 24, Docker 28.5.1, Helm 4.1.4, k3d 5.8.3 and
kubectl 1.30.10. A local workstation can use its own compatible tools. Tier 3 requires at least 4
cores, 16 GB memory and 32 GB total storage; 8 cores, 32 GB memory and 64 GB storage are recommended.
The command reports both the measured total and available storage. It stops on a minimum shortfall
without deleting dependency caches, clusters, images or other developer state.

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
Kubernetes `Certificate`, preserves the exact `.test` ingress authority and refuses state-changing
requests from another browser origin. The per-launch development identity is available only in this
explicit standalone k3d profile; ordinary releases remain OpenID Connect (OIDC)-only.

Each worktree derives its own cluster, namespace, release, registry, ingress port and owner label.
If a previous run retained those exact owned resources, choose explicitly between replacing them
and inspecting them:

```bash
npm run dev:tier3:infra -- --replace-owned
npm run dev:tier3:down
```

`--replace-owned` refuses a similarly named cluster with a missing or different owner label.
`dev:tier3:down` removes only the resources proven to belong to the current worktree. Changing the
0.11 database baseline means rebuilding this disposable environment; there is no pre-1.0 migration
or backwards-compatibility route between stale and current Tier 3 data.
