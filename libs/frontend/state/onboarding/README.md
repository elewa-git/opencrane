# @opencrane/state/onboarding — server-backed onboarding orchestration

> [frontend](../../README.md) › [state](../README.md) › onboarding

## What it owns

This package owns the persona and first-chat gateway ports, validated owner projections, thin
generated-client first-chat adapter, and browser orchestration while keeping every durable fact on
the server. Persona mutations reload the complete owner snapshot; first-chat mutations consume the
complete projection returned by the same server authority.

```
 features/onboarding
       │ survey choices · approval · first-chat answers
       ▼
 ┌───────────────────────────────┐
 │ state/onboarding  ◄── HERE    │  ports · models · validate · orchestrate
 └───────────────────────────────┘
       │ PersonaGateway
       ▼
 persona/adapter ............... typed control-plane API
```

**In this flow:** [features/onboarding](../../features/onboarding/README.md) ·
[persona/adapter](../persona/adapter/README.md)

The persona orchestrator creates a draft only after the completed snapshot proves no tie remains.
The first-chat orchestrator starts only from `bootstrap_chat_pending`, keeps retry identity outside
durable browser storage, and asks the server to conclude only when its latest projection says all
three answers are present. A failed mutation returns no optimistic progress.

The model-adjacent runtime validators strip unknown response extensions and reject invalid lifecycle,
question, score, revision, transcript, source, or completion evidence before feature state can
consume it.

## Public surface

- `PersonaOnboardingService` — load, start, answer, complete, resolve, approve, and restart
  orchestration over the narrow persona gateway.
- `PERSONA_GATEWAY` and `PersonaGateway` — transport-neutral dependency-injection port.
- `_ParsePersonaOnboardingSnapshot` plus persona lifecycle models — bounded response validation and
  the feature-facing projection.
- `PersonaFirstChatService` and `PERSONA_FIRST_CHAT_GATEWAY` — resumable first-chat loading, answer
  admission, and guarded conclusion over a package-internal narrow port.
- `OpenCranePersonaFirstChatGateway` — thin generated-client adapter for the signed-in owner's
  onboarding and first-chat endpoints.
- Package-internal adapter validators fail closed on routing, provenance, transcript order, and
  completion eligibility; only the feature-consumed route, snapshot, transcript, and current-question
  projections plus finite lifecycle enums are exported.

## Boundary

Consumed by the onboarding feature; the persona port is implemented by the persona adapter, while
the bounded first-chat adapter stays beside its model and validator in this cohesive state package.
It holds no browser-storage completion flag or durable transcript, performs no score calculation or
model execution, and cannot assert that an answer, draft, approval, or conclusion succeeded.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:state`. Its role
constraint permits only frontend core and lower dependency-neutral model, contract, or utility
layers. The persona adapter depends inward on this port and model; state cannot import a feature, an
app, or backend source. Its first-chat HTTP adapter depends only on the generated client in core and
the model-adjacent validators in this package.

## See also

- Parent index: [state](../README.md)
- Adapter: [persona/adapter](../persona/adapter/README.md)
- Feature: [features/onboarding](../../features/onboarding/README.md)
