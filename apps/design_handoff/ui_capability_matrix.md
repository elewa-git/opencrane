# OpenCrane UI handoff — mock scenario matrix

## Scope

This handoff delivers the Session and Settings UI against deterministic in-browser mocks. It does
not change or validate OpenCrane backend routes, generated API contracts, CLI commands, OIDC, live
Gateway transport, persistence, or server authorization.

Every screen and interaction in `README.md` is represented through one shared mock provider layer.
Components consume typed facades; they do not contain fixture arrays, timers, generated IDs, or
success-only mutation logic.

## Mock modes

The E2E harness selects a named scenario before navigation:

| Mode | Purpose |
|---|---|
| `default` | Populated happy-path state matching the handoff |
| `empty` | Empty Session, lists, marketplace, Channels, and API keys |
| `loading` | Skeleton and pending states using deterministic deferred responses |
| `error` | Recoverable read and mutation failures |
| `permission` | Hidden/disabled member-versus-admin presentation states |
| `limits` | Budget warning/exceeded and member-capacity states |
| `offline` | Session reconnect, retry, and terminal transport presentation |
| `long-content` | Wrapping, overflow, long names, citations, code, and narrow layouts |

Every mode includes mock identity, active tenant, role, and first-run state. The explicit mock build
registers provider overrides for the existing access and first-run guard tokens; production guard
implementations and the normal build configuration remain unchanged.

## Route-to-scenario coverage

| Route / surface | Mock owner | Reads and interactions | Required scenarios |
|---|---|---|---|
| `/`, `/session/:sessionId` | `MockSessionService` through `SessionFacade` | New/select/share sessions, history, streamed chunks, tools/A2UI blocks, citations, send, cancel, retry, reconnect, Attach, Share | default, empty, loading, error, permission, offline, long-content |
| `/settings/workspace/pod` | `MockSettingsService` through `SettingsFacade` | Pod ID, display name, version, storage, auto-update, Save | default, loading, error, permission |
| `/settings/workspace/members` and organization sub-pages | `MockOrganizationService` through `SettingsFacade` | Invite, roles, budgets, departments, teams, projects, Save/Delete | default, empty, loading, error, permission, limits, long-content |
| `/settings/workspace/budgets` | `MockBudgetService` through `SettingsFacade` | Organization/member spend, limits, routing, reset date, Save | default, loading, error, permission, limits |
| `/settings/workspace/skills` and `/marketplace` | `MockSkillService` through `SettingsFacade` | Installed state, enable/disable, filters, install/uninstall | default, empty, loading, error, permission |
| `/settings/workspace/channels`, `/new`, `/:channelId` | `MockChannelService` through `SettingsFacade` | Provider selection, connection states, configure/test/add/disconnect | default, empty, loading, error, permission |
| `/settings/workspace/data-network` | `MockDataNetworkService` through `SettingsFacade` | Sovereignty status, datasets, egress rows, Add Domain | default, empty, loading, error, permission |
| `/settings/workspace/provider-keys`, `/new` | `MockCredentialService` through `SettingsFacade` | Status metadata, provider selection, test/save/remove | default, empty, loading, error, permission |
| `/settings/personal/account` | `MockSettingsService` through `SettingsFacade` | Avatar, display name, email, role, notifications, Save | default, loading, error, permission |
| `/settings/personal/awareness` | `MockSettingsService` through `SettingsFacade` | Fallback, citation mode, scope order, Save | default, loading, error, permission |
| `/settings/personal/budget` | `MockBudgetService` through `SettingsFacade` | Allocation, spend, reset date, model-class breakdown | default, empty, loading, error, limits |
| `/settings/personal/api-keys` | `MockCredentialService` through `SettingsFacade` | Empty/list, create, one-time reveal, copy, revoke | default, empty, loading, error, permission |

## Mock behavior rules

1. Mock services own the mutable in-memory state for the current test run. Components never mutate
   imported fixture objects directly.
2. Every mutation supports pending, success, validation failure, recoverable failure, cancel where
   applicable, and deterministic reset.
3. Secret-shaped values exist only in the credential form or one-time reveal state. They do not
   enter URLs, logs, persistent browser storage, snapshots, or reusable fixture exports.
4. Time, IDs, streamed chunks, progress, reconnect attempts, and latency use a controllable mock
   clock and seeded values so screenshots and tests are repeatable.
5. Permission scenarios are presentation tests only; they do not claim or simulate server security.
6. The mock provider is enabled explicitly for this UI handoff build. It must not silently masquerade
   as a production backend integration.
7. Mock identity/access providers cover member, administrator, no-tenant, and first-run variants so
   route tests never invoke OIDC or live tenant state.

## UI readiness gate

G1 is ready when the typed mock models, provider APIs, scenario fixtures, reset mechanism, clock, and
test helpers are reviewed and frozen alongside the theme, shared components, route seams, and test
harness. No backend prerequisite blocks this UI-only delivery.
