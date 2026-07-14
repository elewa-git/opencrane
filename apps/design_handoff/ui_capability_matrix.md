# OpenCrane UI handoff — capability matrix

## Purpose

This is the Track 0 release-control inventory for the Session and Settings handoff. `README.md`
defines the intended experience; the generated OpenCrane contract, existing gateways, CLI, and
authorization model decide whether a control may be enabled.

**Readiness conclusion:** conditional / not ready for the two implementation lanes. G1 may prepare
shared tests, tokens, primitives, and disabled/read-only states, but no feature lane starts until the
blocking authorization, contract, CLI, product-scope, and live Gateway decisions are resolved and a
reviewed `UI_SHARED_READY_SHA` is recorded.

Status meanings:

- **Supported** — a live data owner exists and the intended behavior can be implemented.
- **Partial** — only the listed subset may be enabled; the rest remains read-only, disabled with an
  explanation, or outside the release.
- **Blocked** — implementation waits for API, generated contract, CLI, and authorization ownership.

No fixture is a production data source. Every mutation must handle validation, unauthenticated,
forbidden, conflict/not-found, transport, and server failure states as applicable. Destructive and
secret mutations additionally require confirmation, write-only handling, and audit-safe feedback.

## Route-to-capability matrix

| Route / surface | Live owner and generated operation | CLI parity | Authorization | Status and release decision |
|---|---|---|---|---|
| `/`, `/session/:sessionId` | Existing `CONVERSATION_GATEWAY`, cache, render, and A2UI seams; `/sessions/{sessionKey}/scope` (`getSessionScope`, `setSessionScope`, `clearSessionScope`) for scope | `oc sessions scope show/set/clear` for scope; conversational send/history is a Gateway operation | Scope routes accept caller-selected principal/session identifiers without binding them to the caller; Gateway transport/action ownership also needs live proof | **Blocked for production interaction.** Presentation migration may reuse existing behavior, but live chat/action proof is required. Scope show/set/clear, Attach, and designed Share remain disabled until ownership/contracts are repaired and verified. |
| Session contract/citations | `/tenants/{name}/effective-contract` (`getTenantEffectiveContract`) plus existing context/render models | `oc tenants contract` | The tenant path parameter is caller-selected without proven membership enforcement | **Blocked for tenant-derived data.** Existing locally delivered render/context data may be presented, but effective-contract reads wait for server-side tenant scoping. Never synthesize citation variants from the prototype. |
| `/settings/workspace/pod` | `/tenants/{name}` (`getTenant`, `updateTenant`) through `SETTINGS_GATEWAY.getPodIdentity` | `oc tenants get/update` | Tenant reads and writes accept a caller-selected tenant name without consistent membership/org-admin enforcement | **Blocked.** A server-resolved-self endpoint or tenant guard is required even for identity reads. Version, storage quota/address, auto-update, and avatar controls also lack matching fields/contracts. |
| `/settings/workspace/members` and department/team/project sub-pages | `/groups` exists, but no complete member, seat-limit, invitation, department/team/project CRUD contract matching the handoff | No complete matching CLI workflow | Unknown until the missing management contract defines roles | **Blocked.** Do not render functional invite/edit/delete controls or fixture seat counts. API + generated types + CLI are prerequisites. |
| `/settings/workspace/budgets` | `/ai-budget/global`, `/ai-budget/accounts`, `/ai-budget/accounts/{userId}`, and `/{tenantName}/spend` (`get/updateGlobalBudget`, `list/upsert/deleteAccountBudget`, `getTenantSpend`) | `oc budget global/set-global/accounts/set-account/remove-account/spend` | Current routes accept arbitrary tenant/account identifiers without sufficient org-admin/self enforcement | **Blocked for mutation and member tables.** Read-only current-tenant spend is conditional on server-resolved self scope. A stable member join and authorization fix are prerequisites. |
| `/settings/workspace/skills` | `/skills/catalog`; tenant effective-contract reads exist but lack tenant ownership enforcement | `oc skills list/get/create/update/delete`; no install/enable command | Catalogue publication state is not installed/enabled state; tenant entitlement reads are not safely scoped | **Partial.** Only catalogue data is read-only for this screen. Effective entitlement, enable toggles, and marketplace install are blocked; MCP catalogue behavior must not be relabeled as Skills. |
| `/settings/workspace/skills/marketplace` | No confirmed Skills marketplace/install contract matching the design | No confirmed matching command | Unknown | **Blocked** unless product scope is explicitly mapped to supported Skills operations. Do not reuse the MCP catalogue by appearance alone. |
| `/settings/workspace/channels`, `/new`, `/:channelId` | No channel-management contract; MCP and third-party-source endpoints represent different domains | No complete matching channel CLI | Unknown | **Blocked.** Omit fixture cards or show a disabled explanatory empty state. Do not treat MCP connection UI as channel configuration. |
| `/settings/workspace/data-network` | `/tenants/{name}/datasets` and `/policies` reads through `SETTINGS_GATEWAY` | `oc tenants datasets/contract` and `oc policies`; no matching dataset mutation command | Tenant dataset reads accept a caller-selected tenant; policy ownership and egress mapping are also unproven | **Blocked.** Reads wait for server-side tenant/policy scoping and documented mapping. Counts/activity fabricated by the current mapper are prohibited. Add/remove mutations remain blocked. |
| `/settings/workspace/provider-keys`, `/new` | Safe status/write-only secret API is `/providers/byok` (`ByokProviderKeyStatus`) through provider-key state | Current `oc providers` uses legacy `/providers/keys`, not BYOK | BYOK mutations enforce org admin server-side | **Partial.** Presence/timestamps may be shown read-only. Set/remove are blocked until the CLI uses the BYOK contract. Never use the legacy route or rehydrate/log/cache a secret; preserve `/admin` regression coverage. |
| `/settings/personal/account` | `/auth/me` (`getAuthStatus`) supplies identity; the current settings adapter projects tenant data and is not a personal profile owner | `oc auth me`; no personal-profile update command | Self-read is authenticated; personal update does not exist | **Partial.** Display identity/email/picture/role read-only from `/auth/me`. Display-name update, avatar upload, and notifications remain disabled/omitted until a personal-profile API and CLI exist. |
| `/settings/personal/awareness` | `/awareness/*`, `/tenants/{name}/effective-contract`, and session-scope operations | `oc awareness ...`, `oc tenants contract`, `oc sessions scope ...` | Rollout administration, tenant contract reads, and personal/session preferences have different and currently insufficient ownership boundaries | **Blocked.** Contract/scope reads need caller-to-tenant/session binding; fallback and citation preferences need a dedicated personal preference owner. |
| `/settings/personal/budget` | `/ai-budget/{tenantName}/spend` and account-budget reads | `oc budget spend/accounts` | Current API accepts arbitrary tenant/account identifiers without sufficient self-scope enforcement | **Blocked pending authorization repair.** After repair, show only authoritative fields; do not invent by-model totals or reset dates. |
| `/settings/personal/api-keys` | `/access-tokens` and `/{id}` (`listAccessTokens`, `createAccessToken`, `deleteAccessToken`) | `oc tokens list/create/revoke` | Current backend list/create/delete does not bind every operation to the authenticated owner | **Blocked pending owner binding and authorization.** When safe, raw tokens are shown once and token models remain separate from provider credentials. |

## Shared contract decisions

1. `libs/contracts/src/generated/api.ts` is the wire-type source. Components contain no URLs, HTTP
   verbs, or hand-written wire types.
2. App-local facades orchestrate existing gateways and generated-client services; they do not create
   a second session, identity, credential, or cache store.
3. Empty-state and disabled-state text must distinguish unavailable capability from loading, lack of
   data, lack of permission, and service failure.
4. A mutation moves from Partial/Blocked to Supported only when its endpoint, generated type, CLI
   command, data owner, role/capability, validation, and failure behavior are all recorded here.
5. Live acceptance uses a real OIDC session and Gateway. Fixture fallback is a test configuration,
   never a silent production recovery path.

## G0 blockers carried into shared readiness

- Repair and confirm caller/principal/session and caller/tenant binding before any session-scope or
  tenant-derived read is enabled.
- Repair and confirm concrete capability/ownership enforcement for tenant, budget, token, dataset,
  group, and policy mutations before they are enabled.
- Decide whether member/org structure, Skills marketplace, Channels, personal-profile preferences,
  and egress mutation receive backend/CLI prerequisites or leave this release explicitly.
- Prove the live OpenClaw v4 transport/action path and verify Attach and designed recipient-sharing
  contracts before exposing those active Session controls.
- Align `oc providers` with `/providers/byok` and add matching CLI support for any chosen MCP operator
  lifecycle or other management mutation.
- Record response-field coverage for budget breakdowns, storage, version, quotas, reset dates, and
  contract/citation metadata; unsupported decorative values must not become fixtures.
