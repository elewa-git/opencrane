# Local frontend and application development

The default OpenCrane UI development profile runs **onboarding and chat entirely in the browser**.
Use it for routed UI, state, interaction, and error-state work without provisioning the OpenCrane API
or any infrastructure services.

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
mounted in this profile; those URLs return to onboarding.

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

The first plain serve uses the reviewed Commander/Guardian path. Select another reviewed Guardian
path with an explicit Nx configuration:

```bash
npx nx serve opencrane-ui --configuration=development-catalyst
```

The supported configurations are `development-commander`, `development-catalyst`,
`development-anchor`, and `development-analyst`. Opening an explicit configuration saves the choice
in browser local storage for that scheme, hostname, and port. Later plain serves reuse the saved
choice; they do not overwrite it with Commander.

To return to Commander, stop the explicit configuration, run the plain serve, and clear the site's
local storage. Reloading an explicit configuration saves its archetype again. Select another explicit
configuration to replace the choice. Clearing only the downloaded HTTP cache may leave local storage
intact. This preference survives a
reload, but the mock interview and conversations do not.

## Select a deterministic scenario

Add an allowlisted `mockScenario` query parameter to any routed local URL:

```text
http://localhost:4200/chats?mockScenario=reconnecting
```

Available values are:

- `happy-path` — immediate successful onboarding and chat operations;
- `slow` — short delays that keep loading and busy states visible;
- `retry` — the first mutable operation in each flow fails once;
- `reconnecting` — the conversation stream reports a reconnect before becoming live;
- `failed-run` — the Agent run fails so retry controls can be exercised;
- `access-changed` — a visible conversation or child thread becomes unavailable.

An unknown value safely falls back to `happy-path`. Scenario selection is development configuration;
it does not add controls to the product UI.

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

Open `http://local-development.localhost:4200`. The coordinator runs the exact UI command
`npx nx serve opencrane-ui --configuration=development-live`, but supplies a local session and
backend composition so no OpenID Connect (OIDC) sign-in is required.

`development-live` is an Angular build configuration, not a standalone environment. It selects the
real HTTP and WebSocket gateways plus the development proxy instead of Tier 1's in-browser gateway
implementations. Running that Nx command by itself still requires a separately running backend and
valid session; the Tier 2 coordinator starts and configures both for local development.

Core supports onboarding, persisted conversations, direct and group messages, and run admission.
It deliberately leaves Agent execution, models, memory, files, channels, integrations, Obot,
Cognee, the memory gateway, and Kubernetes disabled.

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
| A — local LiteLLM | `npm run dev:tier2:agent:local-llm` | Starts the pinned local LiteLLM container and the local Agent runner. Reads an owner-only OpenAI provider credential from its default or selected file, creates a separate owner-only local master-key file, and stores attempt-scoped virtual keys in a separate `litellm` database within the Tier 2 PostgreSQL container. |
| B — remote LiteLLM | `npm run dev:tier2:agent:remote-llm -- --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path` | Connects the local Agent runner to an explicit remote HTTPS LiteLLM proxy using an owner-only admin-key file. It never falls back to Alternative A's local master key or provider key. |
| C — simulated model | `npm run dev:tier2:agent:simulated-llm` | Runs the local Agent runner with deterministic model events after normal run admission. It starts no LiteLLM process and reads no model or provider credential. |

### Select the local provider-key file

Alternative A reads `keys/.openai-key` when no option is supplied. The filename is a default, not a
LiteLLM requirement. To use the explicit lowercase provider-name convention, create an owner-only
file and pass its path instead of putting the key itself in the command:

```bash
mkdir -p keys
(umask 077 && touch keys/openai-key)
chmod 600 keys/openai-key
${EDITOR:-vi} keys/openai-key

npm run dev:tier2:agent:local-llm -- \
  --provider-key-file keys/openai-key
```

The `--` forwards the option through npm. Explicit files follow
`keys/<lowercase-provider-name>-key`; Alternative A therefore accepts `keys/openai-key` and rejects
uppercase names, other directories, and provider names that do not match its OpenAI configuration.
The coordinator also rejects missing, empty, non-file, or group/world-accessible credential files.
Omitting the option on a later run returns to the compatibility default `keys/.openai-key`; the
selection is not saved in browser storage or rewritten into source.

This option changes only where Alternative A reads its key. The reviewed local LiteLLM profile still
routes `auto` to its configured OpenAI model. For Anthropic, Gemini, or another provider, use
Alternative B with a remote LiteLLM proxy that owns that provider configuration and exposes the
required `auto` alias; do not place a different provider's key in the local OpenAI file.

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

::: warning
Do not use `development-live` as the only proof for a Tier 1 change. A real backend can satisfy a
request that should have used an in-browser Tier 1 gateway, hiding an incomplete mock binding. Run
the default Tier 1 profile so the provider-composition and network-tripwire tests can catch that
drift; use `development-live` only for the separate Tier 2 integration check.
:::
