# @opencrane/elements/ui — shared presentational UI components

> [frontend](../../README.md) › [elements](../README.md) › ui

## What it owns

This is a frontend **element** package: a set of small, reusable display components built on
PrimeNG, the component library used by OpenCrane. They accept typed visual states, draw the shared
paper-and-cyan language, and emit user intent. They never fetch data or decide onboarding, persona,
conversation, or access-policy state.

The package is also the isolated component-catalogue owner used by Storybook. Its catalogue discovers
both the element stories stored here and reviewed feature-state stories stored by their owning
feature package. Feature packages compose these elements with their own domain state, while stories
render every approved state with the same fonts, global tokens, PrimeNG preset, and zoneless change
detection as the application.

```
 feature state  ──typed inputs──►  elements/ui  ◄──PrimeNG controls + OpenCrane tokens
                                      │
                                      └──stories──► visual, interaction, accessibility gates
```

**In this flow:** feature packages own orchestration; `OpenCranePreset` in
[`core`](../../core/README.md) owns the PrimeNG theme mapping.

## Story organisation

Element stories live beside the contract they verify under that component's `__tests__/` directory.
A feature may keep one aggregate state catalogue in its own `src/lib/__tests__/` directory when the
story deliberately composes several feature-local components. This keeps visual, interaction,
accessibility, and unit-test fixtures with their owning package without creating a detached story tree.

Each story must document three things in its Storybook description: the user-facing state it
represents, the component contract it verifies, and the authority it deliberately does **not**
own. `visual-test` stories additionally provide the stable screenshot baseline; `play` stories
prove interactions against the component boundary rather than pretending to exercise a feature's
network or persistence transition.

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
- `JourneyShellComponent` and `JourneyShellLayouts` — the full-viewport responsive paper frame
  shared by bounded sign-in and onboarding journeys.
- `ChoiceCardGroupComponent`, `ChoiceCardOption`, and `ChoiceCardLayouts` — an accessible
  single-choice fieldset rendered as selectable paper cards.
- `JourneyProgressComponent` — an accessible finite progress summary for resumable interviews and
  other bounded journeys.
- `PersonaSummaryComponent`, `PersonaArchetypeScore`, and `PersonaArchetypeTones` — a typed,
  presentation-only persona result with primary, secondary, modifier, and complete score-vector
  states.

## Boundary

Consumed by feature packages such as `features/context`, onboarding, and conversation. It must not
import any `features/*` package: dependencies flow from features into shared elements, never back.
The components own visual semantics and local interaction only; a feature remains responsible for
loading, saving, routing, authorisation, and durable completion.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, `scope:shared`, and `frontend-role:elements`. It may depend only
on `frontend-role:core`; it uses PrimeNG for accessible controls and `@opencrane/core` for shared
visual-language infrastructure. Feature, state, and adapter packages must never flow back into this
package.

## Commands

- `npm run storybook:ui` — serve the local component catalogue.
- `npm run storybook:ui:build` — build the static catalogue.
- `npm run test:storybook` — run interaction and accessibility checks against every story.
- `npm run test:storybook:visual` — compare tagged canonical states with committed screenshots.
- `npm run test:storybook:visual:update` — intentionally refresh those screenshot baselines after
  reviewing the rendered changes; committed baselines live in `tests/storybook/__screenshots__`.

Stories tagged `visual-test-narrow` are captured at the supported 390-pixel viewport instead of the
default desktop viewport, so responsive contracts remain explicit and reproducible.
Stories tagged `visual-test-full-viewport` must render exactly one journey canvas whose height is at
least the selected browser viewport, so short routes cannot expose the body below their surface.

## See also

- Parent index: [elements](../README.md)
- Sibling: [a2ui](../a2ui/README.md)
- Types source: [core](../../core/README.md)
