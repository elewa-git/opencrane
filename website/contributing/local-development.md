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

## Later tiers

Tier 2 and Tier 3 are being rebuilt as incremental successors to the closed historical proposals.
Until their successor pull requests land, do not treat the old branches as supported setup paths.

| Tier | Intended boundary | Status |
| --- | --- | --- |
| Tier 2 core | `npm run dev:tier2` — current server, browser application, PostgreSQL clean baseline and KurrentDB | 🔶 Rebuild planned |
| Tier 2 agent | `npm run dev:tier2:agent` — core plus one current local Conversation Computer | 🔶 Rebuild planned |
| Tier 2 agent alternatives | `npm run dev:tier2:agent:local-llm`, `:remote-llm` or `:simulated-llm` | 🔶 Rebuild planned |
| Tier 3 infra | `npm run dev:tier3` or `npm run dev:tier3:infra` — current silo and prerequisites in disposable k3d, including Codespaces browser routing | 🔶 Rebuild planned |
| Tier 3 agent | `npm run dev:tier3:agent` — infra plus one governed provider setup and one Agent Sandbox conversation turn | 🔶 Rebuild planned |

The repository is on the 0.11 fresh-install baseline. A future Tier 2 `--reset` command will recreate
its paired PostgreSQL and KurrentDB data; it will not migrate an older local database. Do not restore
the retired release-transition command, warm runtime, channel proxy or Obot paths from git history.

Tier 2 will clean only the processes, PostgreSQL/KurrentDB/LiteLLM containers, network and temporary
secrets owned by that launch when it is aborted, stopped, suspended or fails. Tier 3 retains the
historical minimum target of 4 cores, 16 GB memory and 32 GB storage, with 8 cores, 32 GB memory and
64 GB storage recommended. A minimum-host run must report a storage shortfall instead of deleting
unrelated dependency caches, clusters or other developer state.
