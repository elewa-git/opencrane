# @opencrane/features/notifications — the notification popover

> [frontend](../../README.md) › [features](../README.md) › notifications

## What it owns

This is a frontend **feature** package: it owns one UI slice — the notification popover anchored to
the bell in the workspace sidebar — and exports the component the shell renders there. It shows a
list of notification rows, each colour-coded by kind (skill, budget, contract, run, harvest,
policy), with read/unread state and any call-to-action.

It is presentational: it reads the notification model and demo data from `core` and renders it. It
does not fetch from the API and holds no long-lived state of its own.

## Public surface

- `NotificationPanelComponent` — the popover: kind-coloured rows with read/unread state and CTAs.

## Boundary

Intended for the future workspace surface, where it anchors the sidebar bell. It must not import other
feature packages, and it deliberately does not depend on `elements/ui` — its rows are specific
enough that it draws them itself.

## Dependency direction

Tagged `scope:web` (the frontend dependency tier): it may import only other `scope:web` packages
and `scope:shared` contracts. It depends on `@opencrane/core` alone (notification model and data).

## See also

- Parent index: [features](../README.md)
- Consumer: future workspace surface
- Models source: [core](../../core/README.md)
