# Create a managed agent

A **managed agent** is a shared, narrowly scoped worker — the agent that triages incoming tickets,
compiles a weekly report, or runs a nightly data job for a team. Unlike your
[personal assistant](/guide/persona), it isn't built through an interview and it never inherits
anyone's personal access: its published configuration *is* its complete instruction set, and it
runs under its own identity from the moment it's admitted.

::: tip When to reach for a managed agent instead of your personal assistant
Reach for a managed agent when the work should keep running whether or not you're around
(a schedule, an inbound trigger), when several people should be able to trust the same
behaviour, or when the task needs its own bounded, auditable identity rather than yours. For
everything else — day-to-day work for one person — your personal assistant is the right tool.
:::

## Define the agent

Creating and publishing a managed agent is currently an administrator task through the management
API — supply a name, the workload profile it should run under, and the content of its first
revision (its instructions, model choice, budget, and which skills and integrations it may use).
OpenCrane keeps that first revision as a draft until you publish it.

::: info
The OpenCrane UI does not yet expose managed-agent management end to end. Retrieve the exact
request and response shapes from the [API reference](/reference/api) and use an authenticated
client.
:::

Review the draft revision, then publish it. Publishing only succeeds if the revision you reviewed
is still the one about to go live — a concurrent edit can't silently overwrite what you approved.
Enable the published agent before requesting work from it.

## Give it what it needs — and nothing else

A freshly created managed agent has no capabilities. Before it can do useful work, decide:

- Which [skills](/guide/skills) it needs.
- Which [tools](/guide/tools) it may call.
- What [organisational knowledge](/guide/knowledge) it may read.
- What [access rules](/guide/permissions) and [budget](/guide/budgets) apply to it.
- Whether it runs on a schedule or only when triggered.

## Start a run

Once published and enabled, the agent can be run on demand or on its configured schedule. Every
run:

1. re-checks the agent's current grants, budget and membership before doing anything;
2. **freezes** exactly which skills, tools, knowledge and model this attempt may use — the running
   agent cannot widen that set itself;
3. executes in a fresh, disposable container assigned to that one attempt; and
4. records its events, any actions it took, and how it ended.

A retry advances the same logical run rather than starting a disconnected one, and it always gets
a fresh identity for that attempt — it never reuses a stale one.

::: tip
A run is the durable thing to inspect, cancel and audit — not the container that executed it. See
[Review activity](/guide/audit).
:::

## What to configure next

- [Give the agent skills](/guide/skills).
- [Connect tools through MCP](/guide/tools).
- [Add organisational knowledge](/guide/knowledge).
- [Control access](/guide/permissions).
- [Set budget limits](/guide/budgets).

> See also: [Set up your personal assistant](/guide/persona) (the other kind of agent) ·
> [Organize your company](/guide/organize) (deciding a managed agent's scope) ·
> [Agent delegation (child runs)](/guide/child-runs) (having one agent hand work to another)
