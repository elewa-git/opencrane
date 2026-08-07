# What is OpenCrane?

OpenCrane is a **self-hosted platform for AI agents your organisation actually controls.** You
run it on your own Kubernetes cluster, so your conversations, documents and credentials never
leave infrastructure you operate. Every agent starts with no access at all — you decide exactly
what it can see, use and do, and every action it takes is recorded.

## Two kinds of agent, and why the difference matters

OpenCrane draws one hard line through everything it does: the line between **personal** and
**managed**.

- **Your personal assistant** belongs to you. It only ever uses the tools, files and knowledge
  you've been granted, it only ever acts as you, and no one else's assistant can read your
  conversations or your files. → [Set up your personal assistant](/guide/persona)
- **A managed agent** is a shared worker your organisation configures — think "the agent that
  triages support tickets" or "the agent that compiles the weekly sales digest." It runs bounded
  work on a schedule or a trigger, under its own narrow identity, and it never inherits anyone's
  personal access. → [Create a managed agent](/guide/first-agent)

Neither kind can quietly become the other. A managed agent can never read your personal
conversation, memory or files; it only ever sees what it was explicitly configured to see. Your
personal assistant can hand a task to a managed agent, but the managed agent still runs under its
own, smaller identity — see [Agent delegation](/guide/child-runs).

## Why teams choose OpenCrane

- **Private by design** — your data and every agent run stay on infrastructure you operate.
- **Nothing by default** — an agent (personal or managed) starts with zero tools, skills,
  knowledge or model access until you grant it.
- **Every run is a record** — what ran, under what identity, with what inputs and what it did is
  kept, not just the final answer.
- **Execution is disposable, decisions aren't** — the container that ran your request can be
  thrown away; the record of what it was allowed to do and what happened cannot be quietly changed
  after the fact.
- **One boundary per organisation** — your organisation's agents, data and identities are isolated
  from every other organisation on the same OpenCrane installation.

## What you'll do here

1. [Install OpenCrane](/guide/getting-started).
2. [Set up your organisation's domain](/guide/dns).
3. [Set up your personal assistant](/guide/persona) — or
   [create a managed agent](/guide/first-agent) for shared, scheduled work.
4. Give it [skills](/guide/skills), [tools](/guide/tools) and
   [organisational knowledge](/guide/knowledge).
5. Apply [access rules](/guide/permissions) and [budgets](/guide/budgets).

::: tip
Read [How OpenCrane works](/guide/how-it-works) next for a short tour of what happens every time an
agent runs.
:::
