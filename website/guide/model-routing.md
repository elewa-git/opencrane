# Model routing

Instead of wiring each agent to one hard-coded model, register the models your organisation is
allowed to use, and let OpenCrane resolve which one a given run actually calls. Every model call
goes through **LiteLLM**, a self-hosted proxy that fronts your chosen providers, so a raw provider
API key never reaches a runtime container — agents only ever hold a short-lived key scoped to one
model and one spending limit.

## Register models

Use the authenticated `/api/v1/models` surface to list and manage model definitions.
Definitions refer to provider credentials held by OpenCrane; raw provider keys do not enter
claimed runtime Pods.

## Set defaults

`/api/v1/model-routing/defaults` lists and updates defaults by scope and `ClusterTenant`.
Global defaults are operator-only. Organisation-scoped defaults require the matching
authorisation boundary.

When OpenCrane admits a run, it resolves the model route and records it in the
`RunInputSnapshot`. The controller then receives an attempt-scoped LiteLLM key limited to the
selected alias, budget and expiry.

::: tip
Changing a default affects future admissions. It does not change the model route frozen into
an existing run.
:::

::: info
Automated evaluation cases, savings measurements and approval proposals are not mounted in
the current server composition.
:::

## See also

- [Manage cost](/guide/budgets)
- [Review activity](/guide/audit)
- [Telemetry and logging](/operators/telemetry-logging)
- [API reference](/reference/api)
