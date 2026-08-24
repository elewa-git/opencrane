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

This profile supplies an authenticated local user and coherent in-memory gateways for:

- the persona interview, review, and approval;
- the one-time first conversation;
- completed onboarding history;
- Agent, direct, and group conversations;
- Agent-run progress through the production AG-UI reducer;
- conversation files, participant approvals, and child Agent threads.

State lives only in the browser process and resets when the development server reloads.

::: tip
Tier 1 does not need PostgreSQL, Docker, the OpenCrane API, LiteLLM, Cognee, the memory gateway, or a
Kubernetes cluster. Angular HTTP and native OpenCrane API tripwires reject a missed live adapter
locally before it can open a network transport.
:::

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

Use Storybook when a task concerns one component state. Use the Tier 1 routed profile when the task
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

Select the Agent profile to add the local controller and runtime. Alternative A is the default:

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
| A — local LiteLLM | `--alternative A` | Starts the pinned local LiteLLM container. Reads the provider key from `keys/.openai-key`, creates a separate owner-only local master-key file, and stores attempt-scoped virtual keys in a separate `litellm` database within the Tier 2 PostgreSQL container. |
| B — remote LiteLLM | `--alternative B --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path` | Uses the explicit HTTPS proxy and owner-only admin-key file. It never falls back to Alternative A's local master key or provider key. |
| C — simulated model | `--alternative C` | Uses deterministic model events after normal run admission. It starts no LiteLLM process and reads no model or provider credential. |

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
