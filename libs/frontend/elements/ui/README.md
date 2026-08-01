# @opencrane/elements/ui — shared presentational UI components

> [frontend](../../README.md) › [elements](../README.md) › ui

## What it owns

This is a frontend **element** package: a set of small, reusable display components (built on
PrimeNG, the app's default component library) shared across the app's feature screens. They are
purely presentational — they take inputs and draw pixels, and they emit events. They hold no
client-side state, fetch no data, and know nothing about the domain. Feature screens compose them
so the same visual pattern is never hand-written twice (the repo's reusable-component rule).

Each component is a standalone Angular component (self-contained — it declares its own imports
rather than relying on a shared module), uses `OnPush` change detection, and takes signal inputs;
templates and styles live in sibling files.

## Public surface

The package's index file (barrel) re-exports the components directly:

- `ScopeChipComponent` — a coloured chip labelling a data scope.
- `CollapsibleSectionComponent` — an expandable titled section.
- `AvatarCircleComponent` — a circular initials/avatar badge.
- `LedgerCardComponent` — one card in an agent action/observation ledger.
- `SectionHeadingComponent`, `SettingsRowComponent`, `SaveButtonComponent` — settings-form primitives.

## Boundary

Consumed by feature packages such as `features/context`. It must not import any `features/*` package — dependencies flow one way, from features
into shared elements, never back. If the same markup appears in two or more places, extract it here
before writing it a third time.

## Dependency direction

Tagged `scope:web` (the frontend dependency tier): it may import only other `scope:web` packages
and `scope:shared` contracts. In practice it depends only on `@opencrane/core` for shared types and
colour tokens.

## See also

- Parent index: [elements](../README.md)
- Sibling: [a2ui](../a2ui/README.md)
- Types source: [core](../../core/README.md)
