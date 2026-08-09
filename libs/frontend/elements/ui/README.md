# @opencrane/elements/ui — shared presentational UI components

> [frontend](../../README.md) › [elements](../README.md) › ui

## What it owns

This is a frontend **element** package: a set of small, reusable display components built on
PrimeNG, the component library used by OpenCrane. They accept typed visual states, draw the shared
paper-and-cyan language, and emit user intent. They never fetch data or decide onboarding, persona,
conversation, or access-policy state.

The package is also the isolated component-catalogue owner used by Storybook. Feature packages
compose these elements with their own domain state, while stories render every approved state with
the same fonts, global tokens, PrimeNG preset, and zoneless change detection as the application.

```
 feature state  ──typed inputs──►  elements/ui  ◄──PrimeNG controls + OpenCrane tokens
                                      │
                                      └──stories──► visual, interaction, accessibility gates
```

**In this flow:** feature packages own orchestration; `OpenCranePreset` in
[`core`](../../core/README.md) owns the PrimeNG theme mapping.

## Public surface

The package's index file (barrel) re-exports the components directly:

- `ScopeChipComponent`, `ScopeChipTones`, and `ScopeChipAppearances` — a label whose colour and fill
  come only from approved semantic states.
- `CollapsibleSectionComponent` and `CollapsibleSectionVariants` — an accessible expandable region
  with linked trigger and panel semantics.
- `AvatarCircleComponent`, `AvatarTones`, and `AvatarSizes` — a finite initials-avatar contract
  without arbitrary colour or pixel inputs.
- `LedgerCardComponent` and `LedgerCardKinds` — one finite semantic card in an agent
  action/observation ledger.
- `SectionHeadingComponent` — the existing feature-section heading.
- `JourneyShellComponent` and `JourneyShellLayouts` — the responsive paper frame shared by bounded
  sign-in and onboarding journeys.
- `ChoiceCardGroupComponent`, `ChoiceCardOption`, and `ChoiceCardLayouts` — an accessible
  single-choice fieldset rendered as selectable paper cards.

## Boundary

Consumed by feature packages such as `features/context`, onboarding, and conversation. It must not
import any `features/*` package: dependencies flow from features into shared elements, never back.
The components own visual semantics and local interaction only; a feature remains responsible for
loading, saving, routing, authorisation, and durable completion.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, and `scope:web` (the frontend dependency tier): it may import
only other `scope:web` packages and `scope:shared` contracts. It uses PrimeNG for accessible
controls and `@opencrane/core` only for shared visual-language infrastructure; feature/domain
packages must never flow back into this package.

## Commands

- `npm run storybook:ui` — serve the local component catalogue.
- `npm run storybook:ui:build` — build the static catalogue.
- `npm run test:storybook` — run interaction and accessibility checks against every story.
- `npm run test:storybook:visual` — compare tagged canonical states with committed screenshots.
- `npm run test:storybook:visual:update` — intentionally refresh those screenshot baselines after
  reviewing the rendered changes; committed baselines live in `tests/storybook/__screenshots__`.

## See also

- Parent index: [elements](../README.md)
- Sibling: [a2ui](../a2ui/README.md)
- Types source: [core](../../core/README.md)
