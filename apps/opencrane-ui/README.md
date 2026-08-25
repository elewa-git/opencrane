# opencrane-ui — org-admin single-page app

> [apps](../README.md) › opencrane-ui

<!-- No `@opencrane/*` import alias: this is a deployable app (an Angular SPA), titled by its
     `project.json` name (`opencrane-ui`). It is a distinct deployable from the backend
     `apps/opencrane` (the server) — see the note in `apps/opencrane/README.md`. -->

A **deployable app** is a thin unit that composes shared code and ships as one container. This one is
the **org-admin web app**: the browser interface a customer's administrators use to run their slice of
OpenCrane. It is a single-page app (SPA — the whole UI loads once, then re-renders in the browser
without full page reloads), built with Angular.

## What it owns

OpenCrane is **API-first**: every capability is a backend API, and each user interface is just another
client of those APIs. This app owns no business logic of its own — it is the org/customer-facing client.
The backend that serves its APIs is [`apps/opencrane`](../opencrane/README.md) (the OpenCrane server);
this app only renders screens and calls that server.

It composes the frontend feature and state libraries under `libs/frontend/*` — the route table
lazy-loads the persona survey, review, bounded first-chat, normal conversation workspace, member
settings, public invitation acceptance, and MCP tool-administration screens. MCP is the Model Context Protocol for
connecting tools. Two beats
define what it *is* as a deployable:

1. **The served asset** — a static bundle plus a hardened nginx config, so a browser can load it.
2. **The runtime client** — once loaded, the SPA calls the OpenCrane server for data.

```
 browser
   │  GET /            ┌──────────────────────────────┐
   ├──────────────────►│  opencrane-ui  ◄── HERE       │  nginx (unprivileged, :8080)
   │  static SPA shell │  serves the SPA, nothing else │  serves hashed bundles + index.html
   │◄──────────────────└──────────────────────────────┘
   │
   │  the loaded SPA then calls the backend
   │  /api  ·  /gateway   (routed by the chart Ingress, NOT by this nginx)
   ▼
 opencrane server ....... owns all product APIs and authority
```

**In this flow:** [opencrane server](../opencrane/README.md)

**Trust posture.** The nginx here serves the static SPA and nothing else — there is deliberately no
`proxy_pass`. The `/api` and `/gateway` paths are routed to the backend by the silo chart's Ingress, so
the SPA and the API share one origin without this container ever proxying. Inside the app, the platform
surface is pinned to `"org"`: capabilities derive only from the organisation-admin claim. Change
detection is zoneless (no zone.js is bundled), and production data gateways always use the live API.
If the backend is unreachable the live app refuses authenticated actions. The default development
build selects a separate frontend-only profile whose in-memory state is never shipped as authority.

## Public surface

`Entrypoint: src/main.ts` (bootstraps `AppComponent` with `appConfig` from `src/app/app.config.ts`).
Route table `src/app/app.routes.ts`: `login`, `onboarding` (the server-authoritative persona state
shell and first chat), `chats` and `chats/:conversationId` (direct, group, and Agent-session
workspace), `chats/:parentConversationId/threads/:childConversationId` (breadcrumb child Agent
session), `settings/members` (organisation directory and invitations), `invite` (public token
acceptance), and `admin` (MCP tool administration). The root route redirects to
`/onboarding`; protected routes use `OperatorAccessGuard`. The app mounts and guards the Agent-thread
URL; the feature library owns its routed component, browser-history restoration, navigation intents,
and child projection purge.

## Boundary

Browser-only presentation. It holds no server secrets and no database. In live builds, onboarding
progress, persona answers, score evidence, bootstrap transcript, invitation policy, membership, and
completion remain server-owned. The default development profile provides disposable in-memory
equivalents for UI work only. It does not implement authorization — live builds render what the
backend permits and gate screens on backend-supplied capability claims.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:opencrane-ui`. As an entrypoint it composes
`scope:web` frontend libraries (`@opencrane/features/*`, `@opencrane/state/*`, `@opencrane/core`,
`@opencrane/platform`); it may not import backend or app code, and nothing imports it.

## Runtime & config

Build-time and container config (there is no server-side env here — it is a static bundle):

| Concern | Where | Notes |
|---|---|---|
| Gateway and route profile | `src/app/gateway-profile.providers*.ts`, `src/app/app.routes*.ts` | Production and development-live use live gateways and all routes; default development replaces both entry points with the Tier 1 local profile. |
| Static serving | `deploy/nginx.conf` | `nginxinc/nginx-unprivileged`, listens `:8080`, `/healthz` probe, immutable caching for hashed assets, SPA fallback to `index.html` |
| Image | `deploy/Dockerfile` | `ghcr.io/elewa-git/opencrane-ui` |
| Chart-native SPA workload | `helm/templates/_deployment.tpl`, `_service.tpl` | This app owns its optional Deployment/Service as named templates (see `HELM.md`), composed by the silo umbrella chart. The composer supplies the reviewed image's exact OCI digest; deployment fails rather than reporting success if this workload does not roll out with that digest. |

## Local frontend workflow

`npm run serve:opencrane-ui` starts the Tier 1 routed profile, interactive Storybook, and the
Storybook Playwright visual suite together. It provides an authenticated local user and stateful
in-memory implementations for persona onboarding, first chat, normal conversations, AG-UI run
progress, files, approvals, and child Agent threads. It needs no API, PostgreSQL, Docker, LiteLLM,
Cognee, memory gateway, or Kubernetes cluster. Unsupported administration, settings, and invitation
URLs redirect to onboarding. Any accidentally retained Angular or native OpenCrane API adapter is
stopped by a local tripwire.

The first plain serve defaults to the reviewed Commander/Guardian path. Use one explicit command to
change the archetype:

```bash
npx nx serve opencrane-ui --configuration=development-catalyst
```

The supported suffixes are `commander`, `catalyst`, `anchor`, and `analyst`. Loading an explicit
configuration saves that choice in browser local storage for the current origin, so later plain serves
reuse it. To return to Commander, stop the explicit configuration, run the plain serve, and clear the
site's local storage. Reloading an explicit configuration saves its archetype again. Mock workflow
progress still resets on reload; only the archetype preference persists.

Use `?mockScenario=slow`, `retry`, `reconnecting`, `failed-run`, or `access-changed` to exercise a
deterministic non-happy path. `happy-path` is the default. Component-level variants remain
independently available through `npm run storybook:ui` when the routed UI and Playwright pass are not
needed.

`npx nx serve opencrane-ui --configuration=development-live` is the explicit live-backend path. It
uses the live gateway/route entry points and `proxy.dev-live.conf.json`; plain serve has no backend
proxy.

## See also

- Parent index: [apps](../README.md)
- Backend it clients: [opencrane server](../opencrane/README.md)
- Sibling apps: [channel-proxy](../channel-proxy/README.md) · [artifact-service](../artifact-service/README.md)
- Silo chart that composes it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
