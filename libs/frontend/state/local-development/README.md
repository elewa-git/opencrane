# @opencrane/state/local-development — frontend-only application profile

> [frontend](../../README.md) › [state](../README.md) › local development

## What it owns

This package provides one coherent, in-memory implementation of the OpenCrane UI's onboarding and
chat ports. It lets the default development build exercise routed UI and browser state without an
API, database, LiteLLM, Cognee, memory gateway, Docker, or Kubernetes.

The persona survey copies the reviewed `personal-agent-onboarding` v1 questions and choices from the
clean database baseline. Persona review and first chat use the real `The Commander (Guardian)`
template and the exact reviewed Commander bootstrap identity, opening, and prompts. Tier 1 keeps the
result fixed for UI lifecycle testing and deliberately does not reproduce backend scoring. All live
choices remain visible, but this profile admits only its documented Commander/Guardian answer path;
another choice returns a clear local-only error without advancing the survey.

The gateways share one state owner. Approving the mock persona therefore unlocks the same first-chat
record that later appears as completed onboarding history in the conversation workspace. The mock
event stream also emits the same typed AG-UI state consumed by the live workspace.

```
 opencrane-ui mock profile
             │
             ▼
 provideLocalDevelopmentGateways()
             │
             ▼
   LocalDevelopmentState
      │       │       │
      ▼       ▼       ▼
 onboarding  chat   supporting ports
```

**In this flow:** the application chooses the profile, the gateways implement existing ports, and
one disposable state owner keeps cross-route projections coherent.

## Public surface

- `provideLocalDevelopmentGateways()` binds the authenticated session, persona survey, first chat,
  workspace, event stream, conversation assets, elicitation, and Agent-thread ports.
- `mockScenario=happy-path|slow|retry|reconnecting|failed-run|access-changed` selects one
  deterministic development behaviour; unknown values fall back to `happy-path`.

## Dependency direction

This package depends on existing frontend state ports and shared models/contracts. The
`apps/opencrane-ui` composition root depends on this package only when it assembles the mock profile;
port libraries and presentation packages never depend on this development adapter.

## Boundary

This package is development-only state infrastructure. Build-time file replacement makes it
unreachable from production and development-live bundles. It implements existing ports and owns no
presentation, durable product authority, HTTP client, database state, or production fallback. Its
in-memory session and workflow authority is disposable and exists only for the selected development
profile. Any unmocked Angular or native OpenCrane API request is rejected locally by the profile's
network tripwire.

## See also

- Parent index: [state](../README.md)
- Application composition: [opencrane-ui](../../../../apps/opencrane-ui/README.md)
- Live gateway composition: [gateways](../gateways/README.md)
