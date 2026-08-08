# Provider, model, and routing user stories

## Feature intent

Let administrators configure model custody and selection while distinguishing stored configuration,
LiteLLM registration, routability, and actual runtime readiness.

Current status: `API partial`, `UI early` for BYOK only, `Needs decision` for the unified readiness
contract. Auto-routing configuration is not yet consumed by a runtime optimizer.

## MOD-01 — Configure a supported BYOK provider

**As an** organisation admin, **I want** to set or remove a provider API key **so that** OpenCrane can
attempt to register organisation-owned model access without returning the key.

Acceptance criteria:

- Supported providers are OpenAI, Anthropic, Gemini, Mistral, DeepSeek, and GLM.
- Key values are write-only and never redisplayed.
- Status distinguishes not configured, key stored, LiteLLM registered, partially registered,
  unavailable, and removal failed.
- Success does not imply model seeding or routability when `litellmRegistered` is false.

APIs: `GET /api/v1/providers/byok`, `PUT/DELETE /api/v1/providers/byok/{provider}`.

## MOD-02 — Manage scoped provider references

**As a** platform operator or authorised ClusterTenant member, **I want** to manage references to
custodied provider credentials **so that** model definitions bind to metadata rather than raw keys.

Acceptance criteria:

- Scope is `global` or `clusterTenant` with matching authority.
- Fields include provider, `secretRef`, and optional LiteLLM credential name.
- Requests containing raw key fields are rejected.
- Ordinary users do not see sensitive secret-reference detail.

APIs: CRUD under `/api/v1/providers/credentials`.

## MOD-03 — Manage model definitions

**As an** authorised operator, **I want** to create, edit, default, and remove scoped model
definitions **so that** product-facing aliases resolve to approved upstream models.

Acceptance criteria:

- Fields include scope, public model name, upstream model, optional API base, default flag, and
  provider credential.
- Tenant models can bind only global or same-tenant credentials.
- Defined, registering, registered, placeholder/unverified, failed, default, and in-use states are
  visible.
- A persisted row is not automatically labelled runnable.

APIs: CRUD under `/api/v1/models`.

## MOD-04 — Choose explicit routing defaults

**As an** authorised operator, **I want** to select a default model for a scope **so that** future run
admission has an explicit fallback selection.

APIs: CRUD under `/api/v1/model-routing/defaults`.

## MOD-05 — Configure automatic routing policy

**As an** authorised operator, **I want** to configure a cost/quality policy **so that** the intended
future optimizer has bounded choices.

Acceptance criteria:

- Objectives are `cheapest-passing-bar`, `best-quality-within-budget`, or `balanced`.
- Options cover cost-quality slider 0–10, quality floor, maximum budget, allowed models, latency
  ceiling, ordered fallbacks, session pin, and exploration rate 0–1.
- The UI explicitly labels the configuration inactive until a runtime optimizer consumes it.

Status: `API partial`; persistence exists, execution does not.

## MOD-06 — See model capability readiness

**As an** administrator, **I want** a unified readiness explanation **so that** I can distinguish key
custody, LiteLLM registration, model definition, routing selection, and runtime reachability.

Status: `API blocked`; existing endpoints expose fragments but no authoritative readiness projection.
