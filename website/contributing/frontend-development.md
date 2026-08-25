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

Core supports onboarding, persisted conversations, direct and group messages, and run admission.
It deliberately leaves Agent execution, models, memory, files, channels, integrations, Obot,
Cognee, the memory gateway, and Kubernetes disabled.

## Add local Agent chat

Select the Agent profile to add the local controller and runtime. Alternative A (`local-llm`) is the default:

```bash
npm run dev:tier2 -- --profile agent
```

On the first Agent-profile run, the coordinator creates `apps/agent-runtime/.venv` and installs the
pinned runtime requirements into it before starting PostgreSQL. Later runs reuse that environment
while the requirements digest and import check still match. Python 3 and network access to the
configured package index are therefore required only when the environment must be created or repaired.

The alternatives change only the model boundary; all three keep the real admission, assignment,
bootstrap, authenticated runtime stream, candidate validation, and PostgreSQL persistence path.

| Alternative | Command suffix | Model access and credentials |
| --- | --- | --- |
| A — local LiteLLM | `--alternative local-llm` | Starts the pinned local LiteLLM container and the local Agent runner. Reads the provider key from `keys/.openai-key`, creates a separate owner-only local master-key file, and stores attempt-scoped virtual keys in a separate `litellm` database within the Tier 2 PostgreSQL container. |
| B — remote LiteLLM | `--alternative remote-llm --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path` | Connects the local Agent runner to an explicit shared HTTPS LiteLLM proxy using an owner-only admin-key file. It never falls back to Alternative A's local master key or provider key. |
| C — simulated model | `--alternative simulated-llm` | Runs the local Agent runner with deterministic model events after normal run admission. It starts no LiteLLM process and reads no model or provider credential. |

The runtime receives an attempt-scoped LiteLLM key in A/B, never the provider key or LiteLLM
master key. The controller and each runtime attempt also use separate private bearer files; the
runtime bearer is signed for that attempt's generated process identity.

::: info
The coordinator keeps the named PostgreSQL volume between runs but stops containers when the
session ends. Use `--reset` when the target baseline changes; it removes only resources carrying
the OpenCrane local-development ownership label.
:::

::: warning
Do not use `development-live` to prove a Tier 1 change. A successful live request can hide an
incomplete mock binding; the provider-composition and network-tripwire tests exist to catch exactly
that drift.
:::

## Start the Tier 3 full-silo profile

Use Tier 3 for chart rendering, Kubernetes identity, NetworkPolicy, database migration, or other
work that needs the complete silo. Open the repository in its devcontainer, preferably in a GitHub
Codespace, then run:

```bash
npm run dev:tier3
```

The devcontainer uses Docker-in-Docker and pins the smoke toolchain to Node 24, Helm v4.1.4, k3d
v5.8.3, and kubectl v1.30.10. It requests an 8-core, 32 GB, 64 GB Codespace because the full image
and cluster set is intentionally much heavier than Tier 2. Its `npm ci` creation step can be baked
into a repository Codespaces prebuild; enabling that prebuild remains a repository setting and uses
Actions minutes and storage.

The command runs the same current-silo smoke that protects `develop`, with full storage
qualification and `KEEP_CLUSTER=1`. It therefore builds the affected images, installs the pinned
cluster controllers, deploys through the real app-owned release script, and proves database
isolation, TLS ingress, enabled workloads, and storage before returning control to the developer.

After the smoke passes, open the Codespaces port labelled **OpenCrane Tier 3** and keep its
visibility private. A loopback proxy on port 4200 keeps the forwarded `*.app.github.dev` browser
origin but sends the smoke's `.test` host to the k3d ingress. That preserves the SPA, `/api`,
`/gateway`, and WebSocket routing. A direct port-forward to the SPA service would load static files
but fail application routes because the SPA container deliberately has no reverse proxy.

Use the fast local-path storage profile only when storage expansion is outside the change:

```bash
npm run dev:tier3 -- --storage-mode fast
```

Use `--smoke-only` when no browser is needed. The cluster stays available after either command so
you can inspect it with kubectl. When diagnosis is complete, remove that one disposable cluster with
`k3d cluster delete opencrane-develop-smoke`.

::: warning
Tier 3 is a disposable k3d qualification. It does not prove public DNS, production certificates,
cloud workload identity, backup and restore, or a real-tenant upgrade. Those remain remote deploy
and release evidence.
:::
