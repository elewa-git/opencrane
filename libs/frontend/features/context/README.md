# @opencrane/features/context — the right-hand context pane

> [frontend](../../README.md) › [features](../README.md) › context

## What it owns

This is a frontend **feature** package. A feature owns one UI slice — here, the right-hand pane of
the workspace console — and exports the component the shell drops into that slot. It shows the
context behind the current conversation: the awareness contract (what the agent is allowed to see),
the scopes in play, the retrieved sources it cited, the skills it has active, and the ledger trace
of what it did.

It is presentational: it reads models and demo data from `core` and renders them. It does not fetch
from the API itself or hold long-lived state — the workspace shell decides when it is shown.

## Public surface

- `ContextPanelComponent` — the pane: an awareness card and scope strip, an expandable
  retrieved-scope rail with citations, active skills, and the ledger trace.

## Boundary

Intended for the future workspace surface, which hosts it as the right pane. It must not import other
feature packages; shared visuals come from `elements/ui`. Enforcement of what the agent may see
lives on the server — this pane only displays it.

## Dependency direction

Tagged `scope:web` (the frontend dependency tier): it may import only other `scope:web` packages
and `scope:shared` contracts. It depends on `@opencrane/core` (context models and data) and
`@opencrane/elements/ui` (collapsible section, ledger card, scope chip).

## See also

- Parent index: [features](../README.md)
- Consumer: future workspace surface
- Shared visuals: [elements/ui](../../elements/ui/README.md)
