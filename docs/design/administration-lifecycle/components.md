# Component and implementation handoff

This is a PLAN handoff for the [design brief](README.md). It proposes reuse and extension; it does not approve new components or assert that missing API capabilities exist.

## Reuse and extension map

| Region | Decision | Existing owner / implementation direction |
| --- | --- | --- |
| Page heading and action | Reuse | `SectionHeadingComponent` / `wo-section-heading`, page heading variant and action slot. |
| Scope/status | Reuse | `ScopeChipComponent` / `wo-scope-chip`; domain labels come from a feature mapper. |
| Read loading/error/retry | Reuse | `ResourceFeedbackComponent` / `wo-resource-feedback`. Its retry refreshes a read; it must not silently replay a mutation. |
| Provider key entry | Extend | `ModelKeyRowComponent`; preserve controlled `row`, `draft`, `busy` and intent outputs. Add incomplete/unknown-operation presentation. |
| Models, defaults and access | Compose | Feature-owned pane from existing headings/chips and PrimeNG controls. A complete editor does not exist in the inspected slice. |
| Catalogue item | Extend | `ToolCardComponent` / `wo-tool-card`; preserve `server`, `installed`, `busy`, `installRequested`. Add setup and ownership facts. |
| Installed integration | Extend | `InstalledToolRowComponent` / `tr[wo-installed-tool-row]`; add connection intents only alongside a real gateway contract. |
| Governance | Extend | `CatalogueAdminRowComponent` / `tr[wo-catalogue-admin-row]`; preserve approve, publish, reject and enable distinctions. |
| Setup steps | Compose | Feature-local setup region using PrimeNG controls, `JourneyProgressComponent` and `ChoiceCardGroupComponent` where appropriate. Do not force a full-screen journey shell into a settings pane. |
| People | Extend | `MembersViewComponent`, `MemberDirectoryComponent`, `MemberDirectoryRowComponent`, existing invitation form/link components. |
| Role/removal impact review | Compose | Feature-local review panel using the existing accessible overlay primitives; explicit subject, change, consequences and confirmation. |
| Static explanations | Keep inline | Ordinary introductory and help text. |

Start at the [UI barrel](../../../libs/frontend/elements/ui/src/index.ts), [tools feature](../../../libs/frontend/features/tools/README.md) and [settings feature](../../../libs/frontend/features/settings/README.md). Verify actual selectors and supported states again when implementation starts.

## Responsibility boundaries

- Provider reads, secret drafts, per-provider pending commands and authoritative refresh belong to `ModelKeysAdminStore`; `_ToModelKeyRows` maps display; the component owns composition and confirmation focus.
- `ToolsInventoryStore` owns installation lifecycle. `CatalogueAdminStore` owns governance. Cards and rows emit typed user intents.
- Member directory, invitation creation and resend keep their separate stores. `_MapMembersView` maps presentation. The route composes and navigates; the view handles controlled local interaction.
- New connection, version-change and member-mutation owners must retain operation/revision coordinates, discard stale completions, resume exact operations and adopt only authoritative results.
- Shared components receive display state and emit intent. They must not interpret grants, hold credentials, call APIs or infer successful completion from advancing a setup step.
- No generic execute callback should hide retry semantics across unrelated command types.

## Required new visual coverage

Existing member screenshots show ready desktop/mobile states. Provider-key stories cover unconfigured, draft, active, secret-only and saving states. Installed-tool stories cover ready, removing and needs-credential states. These are partial building blocks.

Add full journey states for model selection/testing/defaults, interrupted provider changes, personal/company connection ownership, OAuth cancellation and expiry, update review and failure, member role/removal review, last-admin conflict and access loss. Include retained-data refresh failure, long names, per-row concurrency, keyboard focus and 390px layouts.

Use the production theme and existing Storybook/a11y setup. Keep Linux and macOS evidence distinct. The images in this folder are immutable design references copied from an identified commit, not a new test-baseline directory. New visual acceptance remains in the canonical Storybook workflow.
