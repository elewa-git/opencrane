# OpenCrane UI — Revised Implementation Plan

## Status and purpose

This plan replaces the execution guidance in `ui_implementation_plan.md` without modifying that
original file. It turns the Session and Settings design handoff into a repository-aware Angular
delivery plan.

The target is a high-fidelity implementation of the supplied design, integrated with the existing
OpenCrane application rather than a parallel prototype. Existing session transport, API clients,
authentication, state adapters, rendering, and security behavior must be preserved or deliberately
migrated; they must not be replaced with fixture-only component state.

## Authority and conflict resolution

Apply sources in this order:

1. `docs/agents/angular.md` for frontend architecture, Angular patterns, PrimeNG use, layering, and
   API integration.
2. `docs/agents/typescript.md` for all TypeScript structure, documentation, imports, naming, and
   style requirements.
3. This revised plan for implementation scope, file ownership, sequencing, responsive behavior,
   accessibility, verification, and resolved design ambiguities.
4. `design_handoff/README.md` for visual values, screen inventory, content, and interaction intent.
5. `screenshots/01-session.png` and `OpenCrane.html` for rendered appearance.
6. `App.dc.html` and `MessageList.jsx` for prototype behavior and message/citation intent only.

The HTML and JSX files are design references. Do not copy their React, inline-style, fixture, or
clickable-`div` implementation into production Angular code.

### Canonical color and component decisions

The README contains conflicts between its token table, prose, and prototype. Resolve them as follows:

- Teal `#0db5cc` is the primary brand/action color: primary CTAs, enabled toggles, active settings
  navigation, selected provider cards, selected marketplace pills, and the wordmark accent.
- Orange `#f47920` is the activity color: New session, active dots, unread badges, and the active
  personal scope in the contract summary.
- Red `#c1392b` is danger/warning only: delete, disconnect, remove, uninstall, critical budget
  usage, and capacity warnings.
- Near-black `#1a1918` remains the strong neutral color for user message bubbles and neutral actions
  where the final design explicitly calls for it.
- PrimeNG is the default control and icon library. Theme PrimeNG controls to the handoff. Use an
  inline SVG only for a brand-specific mark or icon that PrimeIcons cannot represent accurately.
- Use PrimeNG `ToggleSwitch`, themed to 44x24px, instead of introducing a separate div-based toggle.
- Self-host DM Sans and DM Mono. Do not load fonts from a runtime CDN.

## Goals

- Deliver the Session and Settings views with the README's visual fidelity and complete screen
  inventory.
- Preserve live conversation transport, history, streaming, tool/A2UI rendering, reconnection,
  cancellation, caching, authentication, and authorization.
- Make every settings page and sub-page deep-linkable and browser-history aware.
- Use one semantic token system and reusable, accessible components.
- Implement only API-supported behavior. Any missing management capability requires an API endpoint,
  generated contract, and matching `oc` command before the UI mutation is enabled.
- Meet the responsive, accessibility, state, test, TypeScript, and independent-review gates below.

## Non-goals

- Shipping the React/design-canvas artifacts.
- Maintaining a second session store or component-local production message history.
- Hand-rolling request or response DTOs already available from `@opencrane/contracts`.
- Adding UI-only platform behavior that is unavailable to the API and CLI.
- Exposing stored provider/channel secrets. Credential fields are write-only.
- Preserving superseded frontend compatibility paths after migration is complete.

## Target Angular architecture

`docs/agents/angular.md` is authoritative. The final application-specific structure is:

```text
apps/opencrane-ui/src/app/
├── core/
│   ├── api/
│   │   ├── session-api.service.ts
│   │   ├── settings-api.service.ts
│   │   ├── members-api.service.ts
│   │   ├── budgets-api.service.ts
│   │   ├── skills-api.service.ts
│   │   ├── channels-api.service.ts
│   │   ├── data-network-api.service.ts
│   │   └── credentials-api.service.ts
│   ├── models/
│   │   ├── session.types.ts
│   │   ├── citation.types.ts
│   │   ├── settings.types.ts
│   │   ├── organization.types.ts
│   │   ├── budget.types.ts
│   │   ├── skill.types.ts
│   │   └── channel.types.ts
│   └── state/
│       ├── session.facade.ts
│       └── settings.facade.ts
├── shared/
│   └── components/
│       ├── app-sidebar/
│       ├── avatar/
│       ├── citation-strip/
│       ├── progress-meter/
│       ├── settings-row/
│       ├── settings-section-header/
│       ├── settings-subpage-header/
│       └── toggle-field/
└── features/
    ├── workspace/
    │   ├── workspace-shell.component.*
    │   └── workspace.routes.ts
    ├── session/
    │   ├── session-page.component.*
    │   ├── session.routes.ts
    │   └── components/
    │       ├── session-header/
    │       ├── message-list/
    │       └── chat-composer/
    └── settings/
        ├── settings-shell.component.*
        ├── settings-nav/
        ├── settings.routes.ts
        ├── workspace/
        │   ├── pod/
        │   ├── members/
        │   ├── budgets/
        │   ├── skills/
        │   ├── channels/
        │   ├── data-network/
        │   └── provider-keys/
        └── personal/
            ├── account/
            ├── awareness/
            ├── my-budget/
            └── my-api-keys/
```

### Existing implementation migration rule

Before creating a file, inspect and reuse the behavior already present in:

- `libs/frontend/features/workspace` for the shell, sidebar, routing, and new-session relay.
- `libs/frontend/features/conversation` and `libs/frontend/state/conversation/*` for the live gateway,
  history, reconnect, abort, stream blocks, Markdown, tools, A2UI, caching, and composer behavior.
- `libs/frontend/features/context` for scope and citation presentation.
- `libs/frontend/features/settings` for current settings sections and resource patterns.
- `libs/frontend/elements/ui` for settings rows, avatars, headings, scope chips, ledger cards, and save
  actions.
- `libs/frontend/features/tools` for marketplace/catalogue and provider-key administration behavior.
- `libs/frontend/state/{settings,provider-key,mcp,tenant}/adapter` and `libs/frontend/state/gateways`
  for current API ownership.

Migrate or compose these capabilities into the authoritative app-level `core/shared/features`
layers. Do not copy the same behavior into parallel stores. Once each migrated slice reaches parity,
remove superseded imports and dead compatibility code in the same track.

### Layer responsibilities

- `core/api`: injectable services using the generated OpenCrane client; no component contains URLs,
  HTTP verbs, or hand-written wire types.
- `core/models`: app-wide enums and view-facing types. Exported interfaces and aliases live in
  dedicated `*.types.ts` files.
- `core/state`: orchestration facades that expose resources, computed state, and mutation commands.
- `shared/components`: presentational components with `input()`/`output()` APIs; no HTTP, routing
  ownership, credential persistence, or feature business logic.
- `features`: route-level containers that compose core services and shared components.

## TypeScript and Angular implementation contract

Every implementation slice must comply with both guidance files:

- Standalone components with `ChangeDetectionStrategy.OnPush` and separate HTML templates.
- Modern `@if`, `@for`, and `@switch`; no `CommonModule`, `RouterModule`, `*ngIf`, or `*ngFor` in new
  or migrated standalone components.
- Import router directives directly when needed.
- Prefer PrimeNG forms, tables, navigation, feedback, dialog, avatar, progress, and toggle controls.
- Use `resource(...)` for asynchronous reads, `rxResource(...)`/`httpResource(...)` for observable or
  HTTP read sources, and command methods for mutations.
- Use `computed(...)` and `effect(...)` for derived/orchestrated state, not manual duplicated flags.
- Use signal-driven forms for new and migrated forms.
- Use enums and switch-based mapping helpers for lifecycle, status, scope, citation, role, and route
  state; do not use magic strings in component decisions.
- Put reusable parsers and mapping helpers in sibling utility files before components gain multiple
  concerns.
- Put every exported interface/type alias in a `*.types.ts` file and document every declaration,
  interface property, and class field with JSDoc.
- Use Allman braces for classes and functions.
- Do not declare standalone arrow functions. Use named functions; arrows remain limited to approved
  higher-order-function callbacks.
- Keep imports at the top, one line per package, ordered from external dependencies to local files.
- Relative imports end in `.js`; package imports have no extension.
- Import workspace packages through their barrel exports rather than internal source paths.
- Follow underscore function naming by visibility: `_camelCase`, `_PascalCase`, `__PascalCase`, and
  `___PascalCase`.
- Add numbered explanatory comments to functions with three or more sequential steps.
- After every TypeScript slice, run `scripts/agent-style-check.sh` on the changed files and include
  the required TypeScript compliance table in the delivery note.

## Route contract

Use nested Angular routes, not a signal-only page switch:

```text
/                                         new session
/session/:sessionId                       selected session
/settings                                 redirect to /settings/workspace/pod
/settings/workspace/pod
/settings/workspace/members
/settings/workspace/members/departments/:departmentId
/settings/workspace/members/teams/:teamId
/settings/workspace/members/projects/:projectId
/settings/workspace/budgets
/settings/workspace/skills
/settings/workspace/skills/marketplace
/settings/workspace/channels
/settings/workspace/channels/new
/settings/workspace/channels/:channelId
/settings/workspace/data-network
/settings/workspace/provider-keys
/settings/workspace/provider-keys/new
/settings/personal/account
/settings/personal/awareness
/settings/personal/budget
/settings/personal/api-keys
```

The workspace shell owns the persistent app sidebar and primary outlet. The Settings shell owns the
200px secondary navigation and its nested outlet. Direct navigation, refresh, browser back/forward,
and invalid identifiers must behave predictably. Route transitions replace section content rather
than opening the documented sub-pages as modal overlays.

## Delivery tracks

### Track 0 — Contract and migration inventory

Complete before parallel visual work begins.

1. Inventory every existing component/service/store listed in the migration rule and classify it as
   reuse, migrate, restyle, replace, or remove.
2. For every visible capability, record the endpoint or gateway method, generated contract type,
   owning core service/facade, required role/capability, supported mutation, and error states.
3. Confirm matching `oc` CLI support for management mutations. Missing API/CLI work is a prerequisite,
   not a frontend mock.
4. Distinguish personal API access tokens from organization provider credentials; they must not share
   models, storage, or permissions merely because both screens say “keys”.
5. Confirm which channel/provider integrations are actually supported. Unsupported fixture cards are
   disabled with an explanation or omitted.
6. Confirm avatar upload, notifications, storage, auto-update, egress mutation, billing limits, and
   organization-structure contracts before promising functional controls.
7. Produce the route-to-capability matrix and migration deletion list before implementation starts.
8. Add `lint` and `test` targets to `apps/opencrane-ui/project.json` before app-local feature code is
   migrated. The app-local target architecture may not depend on tests owned only by libraries that
   are scheduled for removal.
9. Add an `opencrane-ui-e2e` Nx project using Playwright and `@axe-core/playwright`. Define `e2e`,
   `visual`, and `live` configurations; check approved screenshots into
   `apps/opencrane-ui-e2e/src/visual-baselines/`; and publish diffs/reports as CI artifacts.
10. Document the E2E browser matrix, zero-unexplained-diff policy, local/CI commands, test identities,
    and environment variables. The live configuration requires a real OIDC session and Gateway; it
    must not silently fall back to fixtures.

**Gate:** no screen enters implementation with an unknown data owner or an enabled fixture-only
mutation.

### Track 1 — Foundation, theme, and shared components

#### Global theme

Modify the configured global stylesheet `apps/opencrane-ui/src/styles.scss` and the PrimeNG preset:

- Add every semantic token from the README: surfaces, borders, all text levels, teal/orange/red/blue/
  green/amber accents, scope backgrounds, citation backgrounds, role backgrounds, connection status,
  and toggle states.
- Replace ad-hoc component colors with semantic variables.
- Bundle DM Sans weights 300/400/500/600/700 and DM Mono 400/500 under
  `apps/opencrane-ui/public/fonts`; include license files and explicit `@font-face` declarations.
- Define page-title, sub-page-title, session-header, message, body, small-label, uppercase-label, and
  mono typography roles.
- Define geometry tokens: 192px app sidebar, 200px settings nav, 700px chat maximum, 40px 52px 72px
  settings padding, radii, 44x24px toggle, avatar sizes, and 4px scrollbar.
- Produce an accessible semantic-pair table before feature baselines are captured. It records the
  foreground/background values and measured contrast for default, hover, active, focus, selected,
  and disabled states. Any adjustment to the canonical teal/orange/red palette requires design
  approval and becomes the single token value used by all features.
- Add visible focus tokens, approved high-contrast text pairs, disabled states, and reduced-motion
  rules.

#### Shared components

Create or migrate these components under `src/app/shared/components/**`:

- `AppSidebarComponent`: owned/shared session lists, active/unread/activity variants, New session,
  Settings, and signed-in user footer.
- `AvatarComponent`: initials, size, semantic label, and palette selection.
- `CitationStripComponent`: citation ID/type, title, scope, source, and optional status.
- `ProgressMeterComponent`: accessible label, used/limit values, percentage clamp, warning threshold,
  height variant, and text status.
- `SettingsRowComponent`: `260px 1fr` desktop grid, label, description, error/help association, and
  projected control.
- `SettingsSectionHeaderComponent`: title, subtitle, optional count, and primary action.
- `SettingsSubpageHeaderComponent`: routed back link and sub-page title.
- `ToggleFieldComponent`: PrimeNG ToggleSwitch wrapper with label, description, pending, disabled,
  and validation states, themed to the required geometry.

Use PrimeNG Avatar, ProgressBar, ToggleSwitch, Button, InputText, Password, Select, Table, Tabs/
SelectButton, Message, Skeleton, Dialog, and ConfirmDialog where their accessible behavior can be
themed to the design. Create a wrapper only when a pattern repeats or PrimeNG needs a stable design
API.

**Gate:** component tests cover rendering, keyboard behavior, disabled/pending/error states, long
content, and all visual variants before feature pages compose them.

### Track 2 — Workspace shell and Session view

#### Workspace shell and sidebar

- Preserve the persistent shell and routed outlet.
- Implement the 192px dark sidebar with OpenCrane wordmark; orange New session action; MY SESSIONS and
  SHARED groups; active, inactive, unread, and activity states; teal active Settings state; and user
  footer with 28px avatar, name, handle, and department.
- Sidebar inputs come from session and identity facades. Navigation emits route actions; it does not
  maintain duplicate session data.
- Add empty, loading, error, and no-shared-sessions states without changing the desktop geometry.

#### Session header

- Implement the 48px header with session title and department/scope badge on the left.
- Place active model and Share action on the right.
- Define disabled, pending, forbidden, and success/error feedback for Share. If no supported sharing
  contract exists, show a disabled control with explanation rather than an inert button.

#### Message list and citations

- Preserve the existing conversation gateway and rendering pipeline.
- Assistant messages are unbubbled, 15px with 1.7 line-height and 32px bottom spacing.
- User messages are right-aligned near-black bubbles, white 14.5px text, maximum 72% width,
  `14px 14px 3px 14px` radius, `11px 16px` padding, and 28px bottom spacing.
- Continue rendering sanitized Markdown, code, stream/tool blocks, and A2UI surfaces; the restyle must
  not flatten them into plain fixture text.
- Render citation strips below the relevant assistant content with all R/P/A, org/dept/project/
  personal, and applied/done/pending/resolved variants.
- Preserve loading older history, stream pending/final states, cancellation, retry, reconnect, refusal,
  and terminal error behavior.

#### Composer and contract summary

- Implement the white 12px-radius composer with attachment control, multiline textarea, and teal Send
  action.
- Textarea uses 14.5px/1.55, grows to a 140px maximum, and remains reachable above the mobile virtual
  keyboard.
- Enter sends, Shift+Enter inserts a newline, whitespace-only input does not send, and accepted send
  clears the draft.
- Send through the existing gateway. Do not append production messages to a local component array.
- Preserve the reader's position when they are reviewing older history; auto-scroll only when already
  near the bottom or when the current user sends.
- Render the active awareness-contract summary below the composer, with version and ordered scopes;
  highlight the active scope using the canonical token semantics.
- Define attachment type, size, upload progress, cancellation, failure, removal, and unsupported states
  before enabling Attach.

**Gate:** live/mock gateway tests prove history, send, stream, cancel, retry, reconnect, tools/A2UI,
citations, attachment states, and reader-safe scrolling.

### Track 3 — Settings shell and common form behavior

- Build the three-column desktop layout: app sidebar, 200px settings navigation, flexible content.
- Settings navigation includes the uppercase label, Workspace/Personal segmented control, icon/label
  rows, active/inactive states, and self-hosted/data-sovereign footer badge.
- Drive navigation from routes. Switching scope routes to Pod or Account; switching section clears
  obsolete sub-page/provider/channel selection through route destruction rather than hidden stale
  state.
- Use the shared title/subtitle/row/save patterns consistently.
- Every form defines pristine, dirty, invalid, pending, success, conflict, recoverable error, cancel,
  and unsaved-navigation behavior.
- Disable duplicate submissions. Preserve valid user input after recoverable errors.
- Confirm destructive actions with impact-specific copy and restore focus after completion/cancel.

### Track 4 — Workspace Settings sections

#### Pod

- Read-only mono Pod ID with description.
- Display name input.
- OpenCrane version with latest-version label.
- Storage address and Used/Quota/Encrypted statistics.
- Auto-update toggle with Enabled/Disabled label.
- Save action, role gating, loading/unavailable states, and contract-backed validation.

#### Members — People

- Seat count `{used} of {limit}`; warning at 80% and critical/disabled at capacity.
- Invite action; at capacity show the documented banner and semantic disabled explanation.
- People/Teams & Org tabs with correct tab semantics and keyboard navigation.
- People rows use `32px 1fr 90px 200px 72px`: avatar, name/email, role badge, spend values plus 4px
  progress, and Edit action.
- Cover admin/member/viewer roles and normal/near/exceeded budget states.

#### Members — Teams & Org

- Departments/Teams grid `1fr 72px 80px 72px`; parent department rows, chevrons, counts, indented team
  rows, and Edit actions.
- New Department and New Team actions.
- Projects grid `1fr 72px 80px 88px 72px`; counts, Active/Draft status, Open, and New Project.

#### Budgets

- Three-column summary for organization spend/allocation, routing strategy, and reset date.
- Per-member grid `1fr 130px 110px 110px 72px` with editable limit, spent value, mini progress and
  percentage, status, and role context.
- Cover zero budget, normal, warning, exceeded, unavailable, save pending, and conflict states.

#### Skills

- Installed list `1fr 80px 64px 52px`: name, category, version, and enabled toggle.
- Category and lifecycle values come from enums/contracts, not display strings.
- Browse Marketplace routes to its sub-page.
- Enable/disable/install/uninstall actions show pending, success, and rollback/error feedback.

#### Channels

- Cards use `38px 1fr 140px 88px`: icon, name/mono handle, connection status, and Configure action.
- Cover connected, disconnected, connecting, invalid, disabled, and failed states.
- Add Channel routes to its sub-page.

#### Data & Network

- Dark Data Sovereignty banner with status and current scope.
- Dataset rows with name, graph/node/scope metadata, and Active state.
- Egress rows with mono domain, category, and Add Domain action.
- Render read-only data when mutation contracts are absent; never imply an inert edit succeeded.

#### AI Provider Keys

- Provider cards show provider, connection status, supported models, created/updated or last-used safe
  metadata, and Remove action.
- Do not display masked stored key material unless the server explicitly returns a safe non-secret
  fingerprint. Stored secrets are write-only.
- Include the encrypted-storage note and Add Provider Key route.
- Remove/revoke requires destructive confirmation and capability checks.

### Track 5 — Personal Settings sections

#### Account

- 44px avatar and Change Photo action.
- Display name, read-only email with identity-provider explanation, role badge, notification controls,
  and Save.
- If avatar upload or notifications lack contracts, render the values read-only or disable controls
  with explanation.

#### Awareness

- Fallback Behavior select with contract-supported options.
- Citation Mode toggle and Enabled/Disabled status.
- Read-only mono scope order `personal → project → dept → org`.
- Save, validation, permission, unavailable, and conflict states.

#### My Budget

- Large `$used of $limit`, reset date, percentage, and warning color at 80%.
- 7px progress bar with accessible text equivalent.
- By-model-class rows with class, model names, spend, and percentage.
- Cover no allocation, no usage, warning, exceeded, and unavailable states.

#### My API Keys

- Page-level Create Key action.
- Empty state with explanation and “Create your first key” CTA.
- Confirm whether these are OpenCrane access tokens; do not reuse provider-key handling.
- If creation is supported, define one-time reveal, copy, acknowledgement, revoke, and non-recoverable
  dismissal behavior.

### Track 6 — Settings sub-pages

All sub-pages use a routed back link, 24px title, shared settings rows, Save/Cancel, validation,
pending/success/error states, unsaved-navigation protection, and destructive confirmation.

#### Edit Department

- Name input.
- Teams list with member count and Edit Team route.
- New Team in Department action.
- Delete Department and Save actions.

#### Edit Team

- Name input and Department select.
- Member checklist with checkbox, avatar, name, and email.
- Delete Team and Save actions.

#### Edit Project

- Name input and Active/Draft/Archived status select.
- Linked-team checklist.
- Delete Project and Save actions.

#### Skills Marketplace

- Filters: All, Memory, Dev, Productivity, Comms, Research, and Data.
- Rows use `1fr 80px 80px 84px`: name/description, category, mono version, and Install/Uninstall.
- Selected filter uses teal; installed removal remains a red destructive action.

#### Configure Channel

- Safe masked/fingerprint credential metadata only when contract-supported.
- Webhook URL with accessible Copy action.
- Test, Disconnect, and Save actions with connection progress and error feedback.

#### Add Channel

- Three-column provider grid with icon, name, and description.
- Teal selected state.
- Provider-specific fields appear after selection.
- Test Connection and Add Channel actions; secrets remain write-only.

#### Add Provider Key

- Four-column provider grid with name and supported models.
- Teal selected state and selected-provider summary.
- Password input with provider-specific placeholder.
- Test Connection and Save Key actions; never retain the secret after accepted submission.

## Responsive behavior

The supplied design is the desktop reference. Add these implementation requirements:

- `>=1280px`: full 192px app sidebar, 200px settings navigation, 700px maximum chat, and documented
  desktop settings grids/padding.
- `768–1279px`: collapsible app sidebar, compact settings navigation, preserved readable chat width,
  and intentional horizontal scrolling or column prioritization for dense tables.
- `<768px`: app sidebar and Settings navigation become focus-managed drawers; settings rows stack
  label above control; tables become cards, prioritized columns, or contained horizontal scrollers;
  composer remains visible above the virtual keyboard.
- Minimum touch target is 44x44px even when the visible icon is smaller.
- Validate 360x800, 768x1024, 924x540, 1280x800, and 1440x900.
- At 200% zoom and enlarged text, no action becomes unreachable and no page gains unintended
  horizontal overflow.

## Accessibility requirements

Target WCAG 2.2 AA.

- Use semantic buttons, links, headings, forms, tables/lists, tabs, dialogs, and status regions.
- Every input has a visible label and associated help/error text.
- Icon-only controls have accessible names.
- Toggle, tabs, segmented controls, drawers, and dialogs expose correct roles/state and manage focus.
- Keyboard order follows visual order; focus is visible and restored after drawers/dialogs close.
- Streamed assistant updates and save/error feedback use non-disruptive live regions.
- Do not communicate status by color alone.
- Respect `prefers-reduced-motion`.
- Verify contrast for muted sidebar text, teal buttons, badges, disabled controls, and focus indicators;
  adjust token usage where the prototype fails AA while preserving the design hierarchy.
- Complete keyboard-only and screen-reader checks in addition to automated analysis.

## Required UX state matrix

Every asynchronous screen and action must cover:

- initial loading and refresh;
- empty/not configured;
- populated;
- partial or stale data;
- permission denied;
- validation failure;
- pending and duplicate-submit prevention;
- success feedback;
- conflict/concurrent update;
- retryable failure;
- terminal failure;
- disabled with explanation.

Additional domain cases include session connecting/reconnecting/offline/refused, budget normal/warning/
exceeded/unavailable, channel/provider missing/validating/connected/invalid/revoked, skill installing/
enabled/disabled/failed, and assistant history empty/streaming/cancelled/failed.

## Verification and acceptance

### Repository commands

Run the smallest affected set during a track and the full affected gate before merge:

```bash
npm run build:opencrane-ui
npx nx run opencrane-ui:build:production
npx nx run opencrane-ui:lint
npx nx run opencrane-ui:test
npx nx run opencrane-ui-e2e:e2e
npx nx run opencrane-ui-e2e:visual
npx nx run frontend-elements-ui:lint
npx nx run frontend-elements-ui:test
npx nx run frontend-features-workspace:lint
npx nx run frontend-features-workspace:test
npx nx run frontend-features-conversation:lint
npx nx run frontend-features-conversation:test
npx nx run frontend-features-settings:lint
npx nx run frontend-features-settings:test
npx nx run frontend-settings-adapter:lint
npx nx run frontend-settings-adapter:test
npm run lint:boundaries
scripts/agent-style-check.sh --diff origin/main
npx nx affected -t test build lint --base=origin/main
```

Track 0 creates the `opencrane-ui:lint`, `opencrane-ui:test`, and `opencrane-ui-e2e:*` targets before
these commands become required. During migration, run the explicit `frontend-*` library targets for
every library still owning or exporting changed behavior. Remove a library command from the gate only
after its migration is complete, its app-level replacement tests pass, and the superseded library is
deleted. Add `frontend-conversation-adapter`, `frontend-conversation-render`,
`frontend-conversation-cache`, `frontend-provider-key-adapter`, `frontend-tenant-adapter`, or
`frontend-gateways` when changed.

Use `npm run serve:opencrane-ui` for local manual verification. The old
`npm run start opencrane-ui` and `npm run vitest` instructions are invalid.

The production build must remain below the configured 2MB initial-bundle and 14kB component-style
hard limits.

### Component and integration tests

- Shared component tests cover all variants, accessible names, projected content, keyboard events,
  disabled/pending/error states, and long content.
- Route tests cover deep links, redirects, invalid IDs, browser back/forward, scope switching, and
  sub-page returns.
- Session tests cover new/select/shared navigation, history, Enter/Shift+Enter, whitespace rejection,
  draft clearing, streaming, tool/A2UI blocks, citations, cancel/retry/reconnect, and safe scrolling.
- Settings resource tests cover loading, empty, populated, stale, forbidden, and failure states.
- Form tests cover validation, dirty state, pending, duplicate prevention, success, conflict, retained
  values after recoverable failure, and unsaved-navigation confirmation.
- Destructive-action tests cover impact confirmation, pending/disabled state, failure recovery,
  success feedback, and focus restoration.
- API tests cover success, validation, 401, 403, 404, conflict, rate limiting, 5xx, timeout/offline,
  and cancellation where relevant.
- Authorization tests prove hidden/disabled controls cannot substitute for server enforcement.
- Secret tests prove credential values never enter URLs, persistent browser storage, logs, telemetry,
  DOM attributes, snapshots, or reusable fixtures.
- `opencrane-ui-e2e:live` runs against a real deployment and proves OIDC login/logout/session recovery,
  member versus organization-admin authorization, Gateway WebSocket upgrade, history, send, streamed
  output, cancel, transport-loss reconnect, refusal, and terminal failure. Mock tests remain necessary
  for deterministic state coverage but cannot satisfy this live gate.

### Visual acceptance

- Use the supplied 924x540 Session screenshot as the exact reference viewport.
- Capture approved baselines for every Settings section and sub-page at desktop before considering the
  handoff complete.
- Capture responsive baselines at every viewport listed above.
- Cover active/inactive/unread sidebar rows; all citation types/scopes/statuses; user/assistant/tool
  messages; on/off toggles; below/above-limit budgets; below/at-capacity membership; connected/
  disconnected channels; active/draft projects; selected/unselected cards; empty My Keys; and form
  loading/error/success states.
- Review typography, spacing, tokens, borders, wrapping, overflow, scrollbars, focus, hover, active,
  disabled, and validation states. Unexplained baseline changes require design approval.
- Playwright stores approved images under `apps/opencrane-ui-e2e/src/visual-baselines/`; the visual Nx
  target fails on any unexplained pixel diff and uploads actual/diff images for review.

### Accessibility acceptance

- Automated and manual review reports zero unresolved confirmed WCAG 2.2 A or AA violations,
  regardless of the impact label assigned by the tool. Any temporary exception records the exact
  success criterion, evidence, owner, expiry date, and approved remediation plan.
- Keyboard-only navigation reaches and operates every control in logical order.
- Manual screen-reader verification covers at least VoiceOver/Safari or NVDA/Firefox.
- Reflow, 200% zoom, reduced motion, touch targets, focus movement/restoration, live regions, and the
  mobile virtual keyboard are manually verified.

### TypeScript and review gates

- Run `scripts/agent-style-check.sh` after every changed TypeScript slice; resolve all errors and
  inspect every warning.
- Include the required per-file TypeScript compliance table in the delivery note.
- Run Nx boundary checks so the app-level core/shared/features layering remains acyclic.
- After mechanical checks, use the repository `review` agent for a small slice or `review-loop` for a
  multi-file/risky slice.
- Resolve every Critical and High independent-review finding or document concrete evidence that it is
  not applicable.

## Delivery sequence and concurrency

1. Track 0 is blocking and completes first.
2. Track 1 foundation completes before feature styling branches consume tokens/primitives.
3. Track 2 Session and Tracks 3–5 Settings may proceed in parallel after Track 1, provided they do
   not duplicate migration ownership.
4. Track 6 sub-pages begins after the Settings shell and relevant parent data contracts are stable.
5. Responsive/accessibility work is part of each track, followed by a cross-screen consistency pass.
6. Run the full verification and independent-review gates before removing superseded frontend paths.

## Definition of done

The handoff is complete only when:

- Session and every Workspace/Personal Settings section and sub-page are implemented.
- The canonical design decisions and all README geometry/content requirements are represented.
- Existing live conversation, authentication, API, state, rendering, and security behavior remains
  intact.
- Every visible mutation has a generated contract, core service/gateway owner, authorization rule,
  and matching CLI capability.
- All required loading, empty, permission, validation, pending, success, conflict, retry, terminal,
  and destructive states are implemented.
- Responsive baselines pass at all named viewports.
- WCAG 2.2 AA, keyboard, focus, screen-reader, contrast, reduced-motion, zoom, and touch requirements
  pass.
- Production build, affected lint/test/build, boundary, TypeScript style, visual, API, authorization,
  and secret-handling gates pass.
- Live OIDC/Gateway E2E passes with member and organization-admin identities; fixture/mock coverage is
  not accepted as a substitute.
- Independent review has no unresolved Critical or High findings.
- Superseded duplicate frontend code and migration shims are removed.
