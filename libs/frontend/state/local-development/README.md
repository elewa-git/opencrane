# @opencrane/state/local-development — disposable Tier 1 state

> [frontend](../../README.md) › [state](../README.md) › local development

## What it owns

This package owns the backend-free state adapter for Tier 1 frontend development. It lets the
current onboarding and conversation screens run against one coherent in-memory owner while the
live server, databases, models, and Kubernetes workloads remain stopped.

The adapter starts with a reviewed Commander fixture for the plain onboarding command. The survey's
current scoring rules then select the authoritative persona. Named commands instead start the exact
Commander, Catalyst, Anchor, or Analyst conversation requested for that run.

```
 Angular local build
        │ selected archetype and scenario
        ▼
 ┌──────────────────────────────────────┐
 │ local-development adapter  ◄── HERE │
 └──────────────────────────────────────┘
        │ current gateway-port projections
        ▼
 onboarding and conversation features
```

**In this flow:** the [onboarding state](../onboarding/README.md) and
[conversation workspace state](../conversation/workspace/README.md) packages define the ports;
the [OpenCrane UI](../../../../apps/opencrane-ui/README.md) selects this adapter only in Tier 1 builds.

Every emitted lifecycle snapshot follows the same current validators as the live server. Data lasts
only for the browser process, and a reload creates a fresh owner without retaining a hidden persona
preference.

## Public surface

- `provideLocalDevelopmentGateways` binds the current frontend gateway tokens to one in-memory owner.
- `LocalDevelopmentScenarios` lists the finite happy, slow, retry, reconnecting, failed-run, and
  access-changed states.
- `LocalDevelopmentConfig` carries the reviewed archetype, scenario, and onboarding-entry choice.

## Boundary

This package implements existing frontend ports; it does not define product authority or new
archetypes. It makes no HTTP request, opens no database, starts no model, and claims no Kubernetes
isolation. Computer review fails closed because Agent Sandbox execution belongs to Tier 3.

## Dependency direction

The `scope:local-development` rule may depend only on the current conversation, onboarding, shared,
and user-onboarding contracts. Production packages do not depend on this adapter; the application
replaces its live provider composition only in explicit local builds.

## See also

- [Frontend state map](../README.md)
- [Onboarding state](../onboarding/README.md)
- [Conversation workspace state](../conversation/workspace/README.md)
- [Tier 1 contributor guide](../../../../website/contributing/local-development.md)
