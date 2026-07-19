# OpenCrane UI

`apps/opencrane-ui` is the org-admin single-page application: a zoneless Angular shell that
signs a human in via an OIDC session and administers their silo. It is just another client of
the OpenCrane API — every capability it exposes is backed by the public `/api/v1` surface,
reached through the control-plane gateways in `@opencrane/state/*`; the SPA holds no
privileged path and introduces no server behaviour of its own.

The app is deliberately thin: bootstrap, the platform providers (PrimeNG theme, web
`PlatformBridge`, storage and conversation-cache adapters), the top-level route table, and
two guards. Routes are lazy-loaded feature libraries — `login` and `no-tenant` are the only
unguarded pages; `welcome` (first-run onboarding), `customer-admin`, `admin` (MCP catalogue
governance), and the default workspace shell all sit behind the operator-access guard, with
the workspace additionally behind the first-run guard. All behaviour lives in
`@opencrane/features/*`, `@opencrane/state/*`, `@opencrane/core`, and `@opencrane/platform`;
nothing feature-shaped belongs in this directory.

Deployment: the app also owns the optional chart-native SPA Deployment and Service as named
Helm templates under `helm/` (see `HELM.md`), composed by the silo umbrella in
`apps/_infra/deploy-k8s`. The container image builds from `deploy/Dockerfile`.

Tagged `type:app`, `layer:entrypoint`, `scope:opencrane-ui`: as an application it may compose
any library, and no library or app may depend on it.
