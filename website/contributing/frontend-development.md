# Frontend development without a backend

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

## Connect to a real backend explicitly

When a frontend change genuinely needs the shared development backend, select the separate live
configuration:

```bash
npx nx serve opencrane-ui --configuration=development-live
```

That configuration keeps the live provider and route entry points and enables the dedicated
development proxy. Default development replaces those entry points at build time, so production
and development-live bundles do not import the local fixtures. The live configuration therefore
requires a reachable backend and a valid live session.

::: warning
Do not use `development-live` to prove a Tier 1 change. A successful live request can hide an
incomplete mock binding; the provider-composition and network-tripwire tests exist to catch exactly
that drift.
:::
