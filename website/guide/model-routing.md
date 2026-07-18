# Model routing & auto-routing

::: tip In plain terms
Not every task needs your best (most expensive) model. **Model routing** lets you pick the
right model for each kind of work — or let OpenCrane pick for you — and **prove a cheaper
model is just as good before you switch to it**. Less spend, same quality, and you approve
every change yourself.
:::

## What you can do

- **Use the right model for each job.** Pin a skill to a specific model, or let OpenCrane
  choose automatically.
- **Keep each customer to the models they're allowed.** A tenant can only call models you've
  granted them.
- **Prove savings before you commit.** Try a cheaper model against real example tasks, see
  how much you'd save and how confident the result is, and switch only if you approve.

Nothing changes silently. The platform *proposes*; a human *approves*.

## Pick a model per skill

Each skill can be **pinned** to a model you choose, or set to **auto** so OpenCrane picks the
default for that scope. Pin when you want predictability; use auto when you'd rather manage
the choice in one place. When a skill is on auto, the choice comes from a default you set
once — for the whole company, or per customer.

Manage the registered models through `/api/v1/models`, and each skill's posture through
`/api/v1/skills/posture/skill`. Use the generated contracts client or the
[interactive API reference](/reference/api) for the current payload types.

## Keep each customer to their allowed models

Every customer is confined to the models you've granted them. If a model isn't on their
list, their assistants simply can't call it — the boundary is enforced automatically, you
don't have to police it.

## Prove a cheaper model before you switch

This is the part that protects quality. Instead of guessing whether a cheaper model is
"good enough", you measure it:

1. **Give the skill a few example tasks** — the kind of thing it does day to day — with a
   quality bar each answer must clear.
2. **Run a measurement.** OpenCrane tries both your current model and the cheaper candidate
   on every example, has an independent model grade the answers, and reports **how much
   you'd save and how sure it is** of that number.
3. **Nothing changes.** A good result becomes a *suggestion* waiting for your approval — live
   traffic is never touched during a measurement.

Create examples through `/api/v1/model-routing/eval-cases`, then start a run with
`POST /api/v1/model-routing/measurements/run`. All of these routes require authentication.

## Approve or reject — you decide

A measurement that shows real savings turns into a ranked suggestion. You review it and
choose; nothing is ever applied on its own. Approving switches the skill and records the
decision in the [audit log](/guide/audit); rejecting changes nothing.

## See cost & quality at a glance

`GET /api/v1/model-routing/metrics` returns the fleet's cost and quality trend.
Operators see the whole fleet; everyone else sees only their own usage. Credentials
stay on the server — the browser never holds them.

## Going deeper

How model resolution, allowlists, and savings measurement work under the hood is covered in
the [API overview → Model routing](/reference/api-overview#model-routing). The full operator
recipe for turning on measurement lives at
[`docs/operators/routing-measurement.md`](https://github.com/italanta/opencrane/blob/main/docs/operators/routing-measurement.md).

## See also

- [Manage cost](/guide/budgets) — budgets and provider selection
- [Review activity](/guide/audit) — every routing decision is recorded
- [Telemetry & logging](/operators/telemetry-logging) — where the cost and quality data comes from
