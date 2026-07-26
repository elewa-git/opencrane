# @opencrane/state/gateways — gateway DI composition root

> [frontend](../../README.md) › [state](../README.md) › gateways

## What it owns

Part of the OpenCrane **frontend state layer** (the packages between the browser UI and the backend
HTTP API). Every UI screen talks to a **gateway port** — a TypeScript interface it injects — and the
real HTTP work is done by an **adapter** class in a sibling package. Something has to tell Angular's
dependency-injection container *which adapter answers which port*. That wiring is this package: the
**composition root** where all the abstract port tokens get bound to their live implementations.

`provideControlPlaneGateways()` returns the provider list the `opencrane-ui` (org-admin) app spreads
into its config, binding every swappable data gateway to its live adapter in one place:

```
 provideControlPlaneGateways()  ◄── HERE
        │  binds each port token → its live adapter
        ▼
 CONVERSATION_GATEWAY → OpenClawConversationGateway
 SETTINGS_GATEWAY     → OpenCraneSettingsGateway
 USER_TENANT_GATEWAY  → OpenCraneUserTenantGateway
 MCP_GATEWAY          → OpenCraneMcpGateway
 PROVIDER_KEY_GATEWAY → OpenCraneProviderKeyGateway
 PERSONAL_ASSETS_GATEWAY → OpenCranePersonalAssetsGateway
 SKILL_CATALOGUE_GATEWAY → OpenCraneSkillCatalogueGateway
        │  features inject the port, never the class
        ▼
 features/* (UI screens)
```

**In this flow:** [conversation/adapter](../conversation/adapter/README.md) · [settings/adapter](../settings/adapter/README.md) · [tenant/adapter](../tenant/adapter/README.md) · [mcp/adapter](../mcp/adapter/README.md) · [provider-key/adapter](../provider-key/adapter/README.md) · [assets/adapter](../assets/adapter/README.md) · [skills/adapter](../skills/adapter/README.md) · [core](../core/README.md)

It also owns `ActiveTenantStore`, which resolves *which pod a data fetch should target* by reconciling
`SessionStore.currentTenant` with the active `GATEWAY_MODE`, and the `GATEWAY_MODE` token itself
(`"mock"` vs `"live"`). Note this is Angular DI composition — **not** the server `gateways` domain.

Invariant: all production bindings are `"live"`; there is no mock mode in shipped code (in-memory
fakes come from a separate `__test__` package). Binding the ports here keeps transport choice out of
every feature.

## Public surface

- `provideControlPlaneGateways()` — the org-admin app's live gateway provider list.
- `GatewayMode`, `GATEWAY_MODE`, `OperatorGatewayOptions` — the mock/live selector token + options.
- `ActiveTenantStore` — the `tenant` signal every data fetch reads to know which pod to target.

## Boundary

Consumed by `apps/opencrane-ui` (its provider list) and by `features/settings` (which reads
`GATEWAY_MODE`/`ActiveTenantStore`). It imports the adapter classes only to bind them; it defines no
port or wire contract of its own.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here the `state/*/adapter` libs, `state/core`, and Angular — never on apps or server domains.

## See also

- Parent index: [state](../README.md)
- Siblings: [core](../core/README.md) · [assets/adapter](../assets/adapter/README.md) · [skills/adapter](../skills/adapter/README.md) · [tenant/adapter](../tenant/adapter/README.md) · [settings/adapter](../settings/adapter/README.md)
