# OpenCrane UI acceptance harness

This project validates the explicit mock build. It never starts a backend and never exercises OIDC.

## Browser and viewport matrix

All acceptance tests run in Chromium at the three handoff viewports:

| Project | Viewport/device |
|---|---|
| `desktop-chromium` | 1280 × 800 |
| `tablet-chromium` | iPad 7 profile |
| `mobile-chromium` | Pixel 7 profile |

## Commands

Run behavior, route, and automated accessibility acceptance with:

```bash
npx nx run opencrane-ui-e2e:e2e
```

Run zero-tolerance visual comparison with:

```bash
npx nx run opencrane-ui-e2e:visual
```

Approved images live in `src/visual-baselines/<project>/`. Any pixel change fails the visual target
and must be explained and approved before refreshing a baseline. CI retains the HTML report and all
actual, expected, diff, trace, and failure screenshot artifacts.

## Deterministic provider contract

Use `mockScenario` to select `default`, `empty`, `loading`, `error`, `permission`, `limits`, `offline`,
or `long-content`. Use `mockAccess` independently to select `administrator`, `member`, `anonymous`,
`no-tenant`, or `first-run`.

The mock clock advances only when a test calls it. `MockResetService.reset()` restores both selectors,
clears scheduled mutations, reseeds identifiers, and rebuilds every Session and Settings fixture. No
test should reset an individual store when it needs a clean provider boundary.
