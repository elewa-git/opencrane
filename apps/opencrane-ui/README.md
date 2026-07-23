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
lazy-loads a feature per screen (welcome/first-run, the customer-admin console, the MCP tool-admin
console — MCP is the Model Context Protocol for connecting tools — and the workspace shell). Two beats
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
surface is pinned to `"org"`: capabilities derive only from the org-admin claim, so a platform-operator
claim grants nothing here. Change detection is zoneless (no zone.js is bundled), and swappable data
gateways select mock (dev) or live (prod) from one environment flag. If the backend is unreachable the
app degrades to its sign-in/no-tenant screens rather than exposing unauthorised actions.

## Public surface

`Entrypoint: src/main.ts` (bootstraps `AppComponent` with `appConfig` from `src/app/app.config.ts`).
Route table `src/app/app.routes.ts`: `login`, `no-tenant`, `welcome` (first-run onboarding),
`customer-admin`, `admin` (MCP tool admin), and `""` (the workspace shell); guarded by
`OperatorAccessGuard` (authenticated + tenant present) and `FirstRunGuard`.

## Boundary

Browser-only presentation. It holds no server secrets and no database; it persists only local
conveniences (local/session storage, an IndexedDB transcript cache). It does not implement authorization
— it renders what the backend permits and gates screens on backend-supplied capability claims.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:opencrane-ui`. As an entrypoint it composes
`scope:web` frontend libraries (`@opencrane/features/*`, `@opencrane/state/*`, `@opencrane/core`,
`@opencrane/platform`); it may not import backend or app code, and nothing imports it.

## Runtime & config

Build-time and container config (there is no server-side env here — it is a static bundle):

| Concern | Where | Notes |
|---|---|---|
| API/environment selection | `src/environments/environment*.ts` | `environment.ts` (mock) · `.prod.ts` (live) · `.dev-live.ts` (dev against live backend); chosen by build `fileReplacements` |
| Static serving | `deploy/nginx.conf` | `nginxinc/nginx-unprivileged`, listens `:8080`, `/healthz` probe, immutable caching for hashed assets, SPA fallback to `index.html` |
| Image | `deploy/Dockerfile` | `ghcr.io/elewa-git/opencrane-ui` |
| Chart-native SPA workload | `helm/templates/_deployment.tpl`, `_service.tpl` | This app owns its optional Deployment/Service as named templates (see `HELM.md`), composed by the silo umbrella chart |

## See also

- Parent index: [apps](../README.md)
- Backend it clients: [opencrane server](../opencrane/README.md)
- Sibling apps: [channel-proxy](../channel-proxy/README.md) · [artifact-service](../artifact-service/README.md)
- Silo chart that composes it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
