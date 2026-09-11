# opencrane-ui — the team workspace

> [apps](../README.md) › opencrane-ui

<!-- No `@opencrane/*` import alias: this is a deployable app (an Angular SPA), titled by its
     `project.json` name (`opencrane-ui`). It is a distinct deployable from the backend
     `apps/opencrane` (the server) — see the note in `apps/opencrane/README.md`. -->

A **deployable app** composes shared code and ships as one container. This one is the browser
workspace where people set up their personal assistant, talk with colleagues and ask company
assistants to help. Administrators also manage members and tools here. It is a single-page app
(SPA — the UI loads once, then updates without full page reloads), built with Angular.
The browser composition binds personal activity reads to the existing generated API adapter.
The conversation feature owns recent status and loaded-answer links; the app adds no run authority.

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
surface is pinned to `"org"`: sign-in admits a person to the application, while administration
controls use the server's current product-capability projection. The server checks every operation.
Change detection is zoneless (no zone.js is bundled), and production data gateways use the live API.
If the backend is unreachable the app refuses authenticated actions. Build-time provider and route
replacement keeps the disposable Tier 1 fixtures out of production and development-live bundles.

## Public surface

`Entrypoint: src/main.ts` (bootstraps `AppComponent` with `appConfig` from `src/app/app.config.ts`).
Route table `src/app/app.routes.ts`: `login`, `onboarding` (the server-authoritative persona state
shell and first chat), `chats` and `chats/:conversationId` (direct, group, and Agent-session
workspace), `settings/members` (organisation directory and invitations), `invite` (public token
acceptance), and `admin` (MCP tool administration). The root route redirects to
`/onboarding`; protected routes use `OperatorAccessGuard`. Conversation history and computer state
remain on the ordinary chat route; the retired relational Agent-thread projection has no child URL.

For frontend-only work, the default local command replaces live gateways with one disposable
in-memory profile and starts at onboarding:

```bash
npm run serve:opencrane-ui
```

The four reviewed archetypes can open their deterministic personal-Agent conversation directly:

```bash
npm run serve:opencrane-ui:commander
npm run serve:opencrane-ui:catalyst
npm run serve:opencrane-ui:anchor
npm run serve:opencrane-ui:analyst
```

A named command selects its exact archetype for that run. A plain run begins at onboarding with
Commander as the deterministic initial fixture, then uses the reviewed survey result. The local
route table mounts only onboarding and chats, does not use the live
authentication guard, and redirects unsupported live-only routes to the selected entry. Tier 1 makes
no API, PostgreSQL, KurrentDB, Docker, Cognee, LiteLLM, Agent Sandbox, or Kubernetes connection.

## Boundary

Browser-only presentation. It holds no server secrets and no database; onboarding progress, persona
answers, score evidence, bootstrap transcript, invitation policy, membership, and completion remain server-owned. It does not implement authorization
— it renders what the backend permits and gates screens on backend-supplied capability claims.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:opencrane-ui`. As an entrypoint it composes
`scope:web` frontend libraries (`@opencrane/features/*`, `@opencrane/state/*`, `@opencrane/core`,
`@opencrane/platform`); it may not import backend or app code, and nothing imports it.

## Runtime & config

Build-time and container config (there is no server-side env here — it is a static bundle):

| Concern | Where | Notes |
|---|---|---|
| Gateway/route profile | `src/app/gateway-profile.providers*.ts`, `src/app/app.routes*.ts` | local fixtures for default/named development · live adapters for production and development-live; chosen by build `fileReplacements` |
| Static serving | `deploy/nginx.conf` | `nginxinc/nginx-unprivileged`, listens `:8080`, `/healthz` probe, immutable caching for hashed assets, SPA fallback to `index.html` |
| Image | `deploy/Dockerfile` | `ghcr.io/elewa-git/opencrane-ui` |
| Chart-native SPA workload | `helm/templates/_deployment.tpl`, `_service.tpl` | This app owns its optional Deployment/Service as named templates (see `HELM.md`), composed by the silo umbrella chart. The composer supplies the reviewed image's exact OCI digest; deployment fails rather than reporting success if this workload does not roll out with that digest. |

## See also

- Parent index: [apps](../README.md)
- Backend it clients: [opencrane server](../opencrane/README.md)
- Sibling apps: [opencrane server](../opencrane/README.md) · [artifact-service](../artifact-service/README.md)
- Silo chart that composes it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
