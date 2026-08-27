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
npm run serve:opencrane-ui:live
```

That configuration keeps the live provider and route entry points and enables the dedicated
development proxy. Default development replaces those entry points at build time, so production
and development-live bundles do not import the local fixtures. The live configuration therefore
requires a reachable backend and a valid live session.

The proxy currently targets `https://platform.dev.opencrane.ai`. The command has started correctly
when Nx prints the local URL. If the page remains blank while the terminal reports `http proxy
error` or `ETIMEDOUT` for `/api/v1/auth/me`, the shared backend is unreachable from the development
machine. Restore network access to that environment and reload; the live profile deliberately does
not fall back to Tier 1 fixtures.

::: warning
Do not use `npm run serve:opencrane-ui:live` to prove a Tier 1 change. A successful live request can
hide an incomplete mock binding; the provider-composition and network-tripwire tests exist to catch
exactly that drift.
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
