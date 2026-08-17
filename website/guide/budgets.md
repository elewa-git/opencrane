# Manage run limits and cost

OpenCrane uses two different kinds of guardrail: **technical run limits** stop one agent run from
continuing without bound, while **spending budgets** cap money across an account or organisation.
They solve different problems and neither should be mistaken for the other.

| Guardrail | Scope | Purpose |
|---|---|---|
| Technical run limits | One agent run | Bound model turns, total tokens and elapsed time |
| Spending budgets | An account or organisation | Control permitted model spend |

::: info What counts as one run?
One message in an **Agent session** starts one governed run. A later message starts another run.
Ordinary **Direct** and **Group** messages do not start an agent run, so the technical limits on an
agent revision do not apply to those messages. Mentioning an agent from a group conversation does
start an agent run for that request.
:::

## Default limits for a personal assistant

The first revision created for a personal assistant after onboarding carries these defaults:

| Limit | Default | Failure it catches |
|---|---:|---|
| Model turns | 64 | A reasoning or tool-use loop that keeps asking the model for another step |
| Total tokens | 256,000 | A run whose accumulated model input and output grows unexpectedly large |
| Elapsed time | 60 minutes | A stalled provider, waiting tool or other run that does not finish |

The runtime is expected to end only the current run when the first ceiling is reached. That terminal
outcome must not close, archive or change the conversation; the user can inspect what happened and
send another message to start a new run. Operators must complete the qualification described below
before relying on that behaviour.

::: warning These are not monthly spending limits
The 256,000-token value applies to one run. It is not a subscription allowance, account quota or
promise about monthly cost. Configure spending separately through the budget API described below.
:::

All three values belong to the immutable agent revision. OpenCrane freezes that revision when it
admits a run; a running attempt cannot raise its own ceiling. Changing a limit means creating and
publishing a new revision so the old value remains visible in the audit history.

::: info Current enforcement boundary
OpenCrane requires all three positive values before it admits a run and freezes them into the run
snapshot. Operators should qualify the runtime's terminal result for each ceiling in their target
release before treating these limits as an end-to-end operational control. End-to-end enforcement
and qualification are tracked in [GitHub issue #651](https://github.com/elewa-git/opencrane/issues/651).
:::

## Set spending limits

Use the authenticated budget API to set organisation and account ceilings. The current UI
does not expose budget management; retrieve API schemas through the
[API reference](/reference/api).

Spending budgets are one input to the agent service's effective contract. When OpenCrane admits a
run, it freezes the applicable budget policy in the `RunInputSnapshot`.

## During execution

The model-routing service mints an attempt-scoped LiteLLM virtual key. The key carries:

- the allowed model alias;
- the maximum spend for the attempt;
- an expiry aligned with the workload assignment; and
- no upstream provider secret.

The controller writes that key directly to a Job-owned Secret. The runtime reads it from a
file; it never receives the LiteLLM master key.

## When a spending limit is reached

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
