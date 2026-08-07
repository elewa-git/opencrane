# Manage cost

Set a spending ceiling once, and OpenCrane enforces it at the moment a run starts — not after the
fact. Every run, whether it's your personal assistant answering a question or a managed agent
processing a nightly batch, is checked against budget before it's allowed to call a model, and it
receives a spending credential that simply cannot exceed what was approved.

## Set limits

Use the authenticated budget API to set organisation and account ceilings. The current UI
does not expose budget management; retrieve API schemas through the
[API reference](/reference/api).

Budgets are one input to the agent service's effective contract. When OpenCrane admits a run,
it freezes the applicable budget policy in the `RunInputSnapshot`.

## During execution

The model-routing service mints an attempt-scoped LiteLLM virtual key. The key carries:

- the allowed model alias;
- the maximum spend for the attempt;
- an expiry aligned with the workload assignment; and
- no upstream provider secret.

The controller writes that key directly to a Job-owned Secret. The runtime reads it from a
file; it never receives the LiteLLM master key.

## When a limit is reached

A run that cannot pass its budget check is denied or ends with the explicit
`budget_exhausted` terminal reason. OpenCrane does not silently switch to an ungoverned key or
provider path.

::: tip
Use the run id and attempt when reconciling spend. A Kubernetes Pod can be replaced; the
`AgentRun` remains the durable cost record.
:::

## Bring your own provider key

Organisation administrators can configure upstream provider keys through the provider
surfaces documented by the current OpenAPI contract. OpenCrane stores the raw key outside
runtime Jobs and returns status rather than key material from read endpoints.

→ [Model routing](/guide/model-routing) · [Review activity](/guide/audit)
