# Local development tiers

OpenCrane provides three local loops: **browser-only UI**, the **real application with PostgreSQL**,
and a **complete k3d silo**. Start with the lowest tier that proves the change so routine frontend or
API work does not pay the full Kubernetes cost.

> See also: [Contributing overview](/contributing/overview) (where local work fits in the delivery
> process) and [The CI pipeline](/contributing/ci-pipeline) (the checks that qualify the finished
> change).

## Start the Tier 1 profile

Install the workspace dependencies, then run:

```bash
npm run serve:opencrane-ui
```

Open the local URL printed by Nx. The root route enters persona onboarding, and `/chats` opens the
normal conversation workspace. Administration, settings, invitation, and live-login routes are not
mounted in this profile; those URLs return to onboarding when no named archetype profile is active.

That single command also starts the interactive Storybook catalogue and runs the tagged Playwright
visual checks against it. The three processes stay grouped under the Nx task, so UI work and its
component contracts use one local entry point.

This profile supplies an authenticated local user and coherent in-memory gateways for:

- the persona interview, review, and approval;
- the one-time first conversation;
- completed onboarding history;
- Agent, direct, and group conversations;
- Agent-run progress through the production AG-UI reducer;
- conversation files, participant approvals, and child Agent threads.

Mock onboarding and chat state lives only in the browser process and resets when the page reloads.

::: tip
Tier 1 does not need PostgreSQL, Docker, the OpenCrane API, LiteLLM, Cognee, the memory gateway, or a
Kubernetes cluster. Angular HTTP and native OpenCrane API tripwires reject a missed live adapter
locally before it can open a network transport.
:::

## Select the local archetype

The first plain serve enters onboarding on the reviewed Commander/Guardian path. Tier 1 keeps this
path deterministic rather than copying the backend scoring policy into the browser. Select another
reviewed Guardian fixture and open its Agent conversation directly with a named script:

```bash
npm run serve:opencrane-ui:catalyst
```

The supported scripts are:

- `npm run serve:opencrane-ui:commander`;
- `npm run serve:opencrane-ui:catalyst`;
- `npm run serve:opencrane-ui:anchor`; and
- `npm run serve:opencrane-ui:analyst`.

Each named script saves the choice in browser local storage for that scheme, hostname, and port.
Later plain serves still enter onboarding but reuse the saved deterministic path; they do not
overwrite it with Commander.

To remove the saved choice, stop the named profile and clear the site's local storage. Select another
named profile to replace it. Clearing only the downloaded HTTP cache may leave local storage intact.
This preference survives a reload, but the mock interview and conversations do not.

## Select a deterministic scenario

Add an allowlisted `mockScenario` query parameter to any routed local URL:

```text
http://localhost:4200/chats?mockScenario=reconnecting
```

Available values are:

- `happy-path` — immediate successful onboarding and chat operations;
- `slow` — short delays that keep loading and busy states visible;
- `retry` — open `/chats/conversation-agent?mockScenario=retry`, type a message, and send it. The
  first submission shows an error and retains the draft; sending the same draft again succeeds;
- `reconnecting` — open `/chats/conversation-agent?mockScenario=reconnecting`. The first stream
  remains at **Reconnecting** until **Reconnect now** is selected, then its replacement becomes live;
- `failed-run` — the Agent run fails so retry controls can be exercised;
- `access-changed` — open `/chats/conversation-agent?mockScenario=access-changed`. The stream revokes
  the visible projection and the page moves to **Access changed**.

An unknown value safely falls back to `happy-path`. Scenario selection is development configuration;
it does not add controls to the product UI. The initial `retry` view deliberately looks like the
happy path until a mutable operation is attempted; `reconnecting` and `access-changed` are visible
immediately.

## Work on isolated visual states

The component catalogue already covers onboarding, first-chat, workspace, approval, run, access,
responsive, and failure states:

```bash
npm run storybook:ui
```

Use the standalone Storybook command when a task concerns only one component state. Plain Tier 1
serve already includes Storybook and its Playwright visual pass; use the routed UI when the task also
concerns navigation or interaction between stores and gateways.

## Start the Tier 2 core profile

Tier 2 requires the Docker CLI and a running Docker-compatible daemon. Docker Desktop provides both
on macOS and Windows; Docker Engine is sufficient on Linux. Start that container runtime before the
Tier 2 command. The coordinator validates it but does not start Docker Desktop or another daemon.

Use Tier 2 when a change needs the real OpenCrane API and PostgreSQL persistence. The default core
profile starts an owned PostgreSQL 17 container, applies the current target database baseline,
seeds one fixed local user and signed membership, watches the server, and starts the UI with its
live gateways:

```bash
npm run dev:tier2
```

Open `http://local-development.localhost:4200`. The coordinator runs the internal UI target
`npx nx run opencrane-ui:serve-browser:development-live`, then supplies a local session and backend
composition so no OpenID Connect (OIDC) sign-in is required.

`development-live` is an internal Angular build/browser configuration, not a public Tier 1 command.
It selects the real HTTP and WebSocket gateways plus the development proxy instead of Tier 1's
in-browser gateway implementations. The Tier 2 coordinator owns its backend, session, and lifecycle.

Core supports onboarding, persisted conversations, direct and group messages, and run admission.
It deliberately leaves Agent execution, models, memory, files, channels, integrations, Cognee, the
memory gateway, and Kubernetes disabled.

## Add local Agent chat

Select the Agent profile to add the local controller and runtime. Alternative A (`local-llm`) is the default:

```bash
npm run dev:tier2:agent
```

On the first Agent-profile run, the coordinator creates `apps/agent-runtime/.venv` and installs the
pinned runtime requirements into it before starting PostgreSQL. Later runs reuse that environment
while the requirements digest and import check still match. Python 3 and network access to the
configured package index are therefore required only when the environment must be created or repaired.

The alternatives change only the model boundary; all three keep the real admission, assignment,
bootstrap, authenticated runtime stream, candidate validation, and PostgreSQL persistence path.

| Alternative | Command | Model access and credentials |
| --- | --- | --- |
| A — local LiteLLM | `npm run dev:tier2:agent:local-llm` | Starts the pinned local LiteLLM container and the local Agent runner. Selects a reviewed provider/model from conventional owner-only key files, creates a separate owner-only local master-key file, and stores attempt-scoped virtual keys in a separate `litellm` database within the Tier 2 PostgreSQL container. |
| B — remote LiteLLM | `npm run dev:tier2:agent:remote-llm -- --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path` | Connects the local Agent runner to an explicit remote HTTPS LiteLLM proxy using an owner-only admin-key file. It never falls back to Alternative A's local master key or provider key. |
| C — simulated model | `npm run dev:tier2:agent:simulated-llm` | Runs the local Agent runner with deterministic model events after normal run admission. It starts no LiteLLM process and reads no model or provider credential. |

### Select a local model

Alternative A recognizes these provider/model pairs from the reviewed
[local-provider registry](https://github.com/elewa-git/opencrane/blob/main/libs/models/local-development/main/provider-contract.json):

- Anthropic: `anthropic/claude-sonnet-4-5-20250929` with `keys/.anthropic-key`
- Gemini: `gemini/gemini-2.5-flash` with `keys/.gemini-key`
- Mistral: `mistral/mistral-small-latest` with `keys/.mistral-key`
- OpenAI: `openai/gpt-5.4-nano` with `keys/.openai-key`

Create the matching owner-only key file. The file contains only the upstream provider key:

```bash
mkdir -p keys
(umask 077 && touch keys/.anthropic-key)
chmod 600 keys/.anthropic-key
${EDITOR:-vi} keys/.anthropic-key

npm run dev:tier2:agent:local-llm -- \
  --provider anthropic
```

The `--` forwards `--provider` through npm. An explicit provider uses its reviewed `defaultModel`.
To choose another model owned by that provider, pass both options:

```bash
npm run dev:tier2:agent:local-llm -- \
  --provider anthropic \
  --model anthropic/claude-sonnet-4-5-20250929
```

You may also pass `--model` alone; its exact registry entry selects the owning provider. When both
options are present, startup rejects a model owned by a different provider. The registry—not the
text before `/` in an arbitrary model name—derives `keys/.<provider>-key`, so an unreviewed provider
or model fails before a credential is read. The coordinator also rejects a selected key that is
missing, empty, linked, not a regular file, or accessible by group or other users.

When both `--provider` and `--model` are omitted, the coordinator lists recognized key files, sorts
their filenames, and chooses the first provider. Because every provider file is hidden, ordinary
lexical order applies directly: for example, `keys/.anthropic-key` sorts before
`keys/.openai-key`. The coordinator uses that provider's `defaultModel` from the registry.
Unreviewed provider names do not participate, and the choice is recalculated on every run from the
current `keys/` directory.

At startup, Alternative A resolves only the selected provider/model and writes its secret-free
LiteLLM configuration under `apps/_infra/litellm/local-development/` if that generated file does not
already exist. Each file maps OpenCrane's stable `auto` alias to one exact reviewed model. The
coordinator reuses matching generated files on later runs, mounts only the selected file, and reads
and supplies only its matching key. Generated `*.generated.yaml` files are ignored by Git and remain
after shutdown so switching among previously used models does not regenerate them.

Adding a provider or model still requires review: extend the registry and the model-selection tests
together. Merely adding `keys/.<new-provider>-key` does not admit an unreviewed provider.

### Configure a remote LiteLLM proxy

Alternative B's endpoint and key path above are placeholders. Ask the proxy operator for:

- an HTTPS origin such as `https://litellm.dev.example.com`, without credentials, a path, query, or
  fragment; and
- an organisation-scoped LiteLLM admin key that can read `GET /model/info` and mint an
  attempt-scoped key through `POST /key/generate`.

The proxy must expose a model alias named `auto`. Use a dedicated proxy or an admin credential
scoped to this OpenCrane organisation; a fleet-wide key can mint credentials outside this local
development boundary. OpenCrane limits each runtime key it mints to one model alias, budget, and
expiry, but those limits do not replace isolation enforced by the remote proxy.

Create an owner-readable key file without placing the key in the command itself:

```bash
mkdir -p keys
(umask 077 && touch keys/.remote-litellm-admin-key)
chmod 600 keys/.remote-litellm-admin-key
${EDITOR:-vi} keys/.remote-litellm-admin-key
```

Put the admin key alone in that file, without quotes. Then replace the example hostname and run:

```bash
npm run dev:tier2:agent:remote-llm -- \
  --remote-litellm-endpoint https://litellm.dev.example.com \
  --remote-litellm-master-key-file "$PWD/keys/.remote-litellm-admin-key"
```

The `--` after the npm script forwards the two options to the Tier 2 coordinator. The coordinator
checks the endpoint, key permissions, admin-key access, and `auto` alias before it prepares Python or
starts a local container.

### Smoke-test the remote proxy

Use this endpoint-only check when you want to confirm the placeholders before starting Tier 2. It
reads the key inside Node, sends it only in the HTTPS authorization header, and never prints it:

```bash
export REMOTE_LITELLM_ENDPOINT=https://litellm.dev.example.com
export REMOTE_LITELLM_ADMIN_KEY_FILE="$PWD/keys/.remote-litellm-admin-key"

node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";

const endpoint = process.env.REMOTE_LITELLM_ENDPOINT.replace(/\/$/, "");
const key = (await readFile(process.env.REMOTE_LITELLM_ADMIN_KEY_FILE, "utf8")).trim();
const response = await fetch(`${endpoint}/model/info`, {
  headers: { authorization: `Bearer ${key}` }
});

if (!response.ok)
{
  throw new Error(`LiteLLM returned HTTP ${response.status}`);
}

const body = await response.json();
if (!body.data?.some(model => model.model_name === "auto"))
{
  throw new Error("LiteLLM does not expose the required auto model alias");
}

console.log("Remote LiteLLM authentication and auto alias are ready.");
NODE
```

An HTTP `401` or `403` means the key is wrong or lacks admin access. A connection error points to
DNS, VPN, firewall, or certificate trust. An `auto` error means the proxy operator must add that
alias before Agent chat can mint a restricted runtime key.

For a short end-to-end check, start the remote profile command, open
`http://local-development.localhost:4200`, enter an Agent conversation, and send one small prompt.
A completed response proves the server minted an attempt key, the local runtime reached the remote
proxy, and the authenticated runtime and conversation streams returned the result. Press `Ctrl+C`
once and wait for cleanup when the check finishes.

The runtime receives an attempt-scoped LiteLLM key in A/B, never the provider key or LiteLLM
master key. The controller and each runtime attempt also use separate private bearer files; the
runtime bearer is signed for that attempt's generated process identity.

::: info
The coordinator keeps the named PostgreSQL volume between runs. Press `Ctrl+C` and wait for the
command to exit before starting another profile. `Ctrl+Z` is also treated as a graceful shutdown,
not as a suspended job. Either path stops PostgreSQL, removes an owned local LiteLLM container,
removes temporary credentials, and releases the single-session lock. Use `--reset` when the target
baseline changes; it removes only resources carrying the OpenCrane local-development ownership label.
:::

The lock deliberately rejects a second Tier 2 coordinator because profiles share listener ports,
the PostgreSQL volume, and the fixed local identity. Press `Ctrl+C` once and wait for cleanup before
starting another profile. `Ctrl+Z` now requests the same cleanup instead of suspending the command,
so no `fg` sequence or repeated signal is required.

### Recover stale frontend dependencies

Clear the Angular and Nx caches only when the browser console reports `504 Outdated Optimize Dep`.
This error can appear after switching branches whose Angular or Vite dependency graph differs. It
does not indicate a database-baseline mismatch, so do not add `--reset` for this recovery.

Stop the Tier 2 coordinator with `Ctrl+C`, wait for cleanup, then run:

```bash
rm -rf .angular/cache
npx nx reset
npm run dev:tier2:agent
```

Restart the profile you were using if it was not the default Agent profile. For an ordinary branch
switch without the `504 Outdated Optimize Dep` error, stop the coordinator, switch branches, and
restart the profile without clearing either cache.

## Start the Tier 3 full-silo profile

Use Tier 3 for chart rendering, Kubernetes identity, NetworkPolicy, target-baseline installation, or other
work that needs the complete silo. Open the repository in its devcontainer, preferably in a GitHub
Codespace, then run:

```bash
npm run dev:tier3:infra
```

This credential-free profile (also available as `npm run dev:tier3`) qualifies infrastructure and
login without reading a provider key. The silo has no default model until the logged-in developer
configures one through the authenticated provider settings flow.

The devcontainer uses Docker-in-Docker and pins the smoke toolchain to Node 24, Helm v4.1.4, k3d
v5.8.3, and kubectl v1.30.10. It enforces a 4-core, 16 GB memory, 32 GB storage minimum so Codespaces
can offer smaller machines. The full image and cluster set uses approximately 6 CPUs, 10–12 GB of
memory, and 25–30 GB of storage, so the minimum host skips the workspace dependency tree and uses
local-path storage while still deploying every application workload. Use the recommended 8-core,
32 GB memory, 64 GB storage machine for storage-expansion qualification, repository-wide work, and
repeated builds. When at least 40 GB remains free, the creation step runs `npm ci` and can be baked
into a repository Codespaces prebuild; enabling that prebuild remains a repository setting and uses
Actions minutes and storage.

On the minimum disk, Tier 3 removes an existing root `node_modules` tree, clears disposable npm and
BuildKit caches, reserves 12 GiB for all images that arrive after the build, imports one local image at
a time, and removes each Docker-side source after k3d accepts it. Reinstall the lockfile-bound
dependencies before other repository work. The retained cluster keeps its own copy, and k3d's
[direct importer](https://k3d.io/v5.8.3/usage/importing_images/) creates no intermediate archive.
Keep k3d's default image volume: the pinned v5.8.3 create path rolls back the cluster when Codespaces
disables that volume. A recommended-size machine can retain the caches, use the faster batch import,
and qualify storage expansion:

```bash
SMOKE_HOST_PROFILE=recommended npm run dev:tier3 -- --storage-mode full
```

Each minimum-host rerun resets the named disposable cluster and its run-owned Docker image storage,
then repeats the bounded sequential build and import. The previous successful cluster stays
available for browsing and `kubectl` diagnosis only until that next run, so there is no need to
delete it manually before rerunning. This clean rebuild is slower but keeps disk use predictable on
the 32 GB machine. Use the recommended profile when repeated builds should retain workspace
dependencies and reusable caches.

The contributor command also allows 600 seconds for workload readiness on a loaded Codespace.

The command runs the same current-silo smoke that protects `develop`, with `KEEP_CLUSTER=1`. It
therefore builds the affected images, installs the pinned cluster controllers, deploys through the
real app-owned release script, and proves database isolation, TLS ingress, enabled workloads, and
the selected storage profile before returning control to the developer.

After the smoke passes, open the Codespaces port labelled **OpenCrane Tier 3** and keep its
visibility private. A loopback proxy on port 4200 keeps the forwarded `*.app.github.dev` browser
origin but sends the smoke's `.test` host to the k3d ingress. That preserves the SPA, `/api`,
`/gateway`, and WebSocket routing. A direct port-forward to the SPA service would load static files
but fail application routes because the SPA container deliberately has no reverse proxy.

Click **Login** to establish the installation-selected `Tier 3 Developer` identity. This disposable
profile does not contact an external OpenID Connect provider. The loopback proxy overwrites any
browser-supplied proof with a fresh per-run secret; the server then projects the exact fixed identity
into its durable Principal and standalone Owner records before issuing a bounded signed session.
Starting Tier 3 again rotates both the proxy proof and the session key, invalidating sessions from
the preceding disposable cluster.

### Configure models after login

Tier 3 deliberately installs without provider credentials. After the fixed development identity
logs in, configure a provider through the normal authenticated provider settings flow. This keeps
the durable provider-effect command, central authorization decision, and fixed Secret custody as
the only supported route; deployment never writes provider keys or chooses a routing default.

::: warning
Keep the forwarded Tier 3 port private. Its login identity is deliberately selected by the local
development installation and is not an organisation sign-in mechanism.
:::

The minimum-host command uses fast local-path storage. Select full storage when the change concerns
storage expansion:

```bash
npm run dev:tier3 -- --storage-mode full
```

Use `--smoke-only` when no browser is needed. The cluster stays available after either command so
you can inspect it with kubectl. When diagnosis is complete, remove that one disposable cluster with
`k3d cluster delete opencrane-develop-smoke`.

::: warning
Tier 3 is a disposable k3d qualification. It does not prove public DNS, production certificates,
cloud workload identity, backup and restore, or a real-tenant upgrade. Those remain remote deploy
and release evidence.
:::

## Add a gateway-backed feature

A **gateway** is the narrow state-layer interface through which a feature reads or changes data.
Keep the feature dependent on that interface so the live application and Tier 1 can supply different
implementations without changing the page.

```text
feature store
     │ injects a narrow gateway token
     ▼
state port
     ├──→ live generated-client adapter ──→ OpenCrane API
     └──→ Tier 1 in-memory adapter ───────→ LocalDevelopmentState
```

Add a gateway-backed feature in this order:

1. Define the gateway interface and Angular injection token in the capability's
   `libs/frontend/state/<capability>` package.
2. Implement the live adapter with the generated OpenCrane client, then bind it in
   [`provideOpenCraneUiLiveGateways()`](https://github.com/elewa-git/opencrane/blob/main/libs/frontend/state/gateways/src/lib/opencrane-ui-gateway-profile.provider.ts).
3. If Tier 1 mounts the feature, add an in-memory adapter under
   [`state/local-development`](https://github.com/elewa-git/opencrane/tree/main/libs/frontend/state/local-development)
   and bind it in `provideLocalDevelopmentGateways()`. Reuse `LocalDevelopmentState` when the new
   data must remain coherent with onboarding or conversations.
4. If a coherent backend-free implementation is not available, leave the route out of
   [`app.routes.local.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane-ui/src/app/app.routes.local.ts)
   instead of supplying a partial adapter.
5. Test the state port, live adapter mapping, live provider binding, local provider binding, and
   route availability.

An omitted local binding fails visibly. Angular reports a missing provider, while a retained HTTP or
generated-client path is rejected by the Tier 1 network tripwire before it reaches the network. Tier 1
never silently borrows the live backend.
