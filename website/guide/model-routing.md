# Model routing & auto-routing

::: tip In plain terms
Not every task needs your best (most expensive) model. **Model routing** lets you pick the
right model for each kind of work — or let OpenCrane pick for you. Less spend, same quality,
and you stay in control of every change.
:::

## What you can do

- **Use the right model for each job.** Pin a skill to a specific model, or let OpenCrane
  choose automatically.
- **Keep each customer to the models they're allowed.** A tenant can only call models you've
  granted them.

Nothing changes silently — routing follows the defaults and pins you set yourself.

## Pick a model per skill

Each skill can be **pinned** to a model you choose, or set to **auto** so OpenCrane picks the
default for that scope. Pin when you want predictability; use auto when you'd rather manage
the choice in one place. When a skill is on auto, the choice comes from a default you set
once — for the whole company, or per customer.

Manage the registered models through `/api/v1/models`, and the auto defaults through
`/api/v1/model-routing/defaults`. Use the generated contracts client or the
[interactive API reference](/reference/api) for the current payload types.

## Keep each customer to their allowed models

Every customer is confined to the models you've granted them. If a model isn't on their
list, their assistants simply can't call it — the boundary is enforced automatically, you
don't have to police it.

::: info The automated savings-measurement loop has been retired
Earlier versions shipped a built-in measurement loop (`eval-cases` and `measurements/run`
endpoints) that graded a cheaper candidate model against example tasks before a switch.
That loop has been removed and its routes no longer exist. To change a skill's model,
update its pin or the auto default yourself, and use the cost and quality metrics below to
judge the result.
:::

## See cost & quality at a glance

`GET /api/v1/model-routing/metrics` returns the fleet's cost and quality trend.
Operators see the whole fleet; everyone else sees only their own usage. Credentials
stay on the server — the browser never holds them.

## Going deeper

How model resolution and allowlists work under the hood is covered in
the [API overview → Model routing](/reference/api-overview#model-routing).

## See also

- [Manage cost](/guide/budgets) — budgets and provider selection
- [Review activity](/guide/audit) — every routing decision is recorded
- [Telemetry & logging](/operators/telemetry-logging) — where the cost and quality data comes from
