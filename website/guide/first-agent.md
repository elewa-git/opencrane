# Shared agents

A **shared agent**, called a managed agent in the API, is intended to carry out a defined company
task. Examples include preparing a weekly sales report or triaging incoming support tickets.

::: info Planned execution
The 0.11 baseline retains agent definitions and configuration, but does not expose supported
managed-agent scheduling, run-now, retry or cancellation. Defining an agent does not make shared
automation available. See [development status](/guide/status).
:::

## Decide what the task needs

Describe the outcome first:

- What should the agent produce, and for whom?
- Which tools and company information does it need?
- Should a person approve any action?
- What spending limit and schedule would suit the task?

A shared agent will have its own permissions. Creating or using it must not silently give it the
creator's personal conversations, memory or tools.

## Definitions and configuration

Administrator APIs provide agent definitions and revisions: named versions of instructions,
models, limits and permitted resources. Use the [API reference](/reference/api) for the current
management surface.

The execution journey remains future work. This guide does not provide a schedule or run command
for an unavailable runtime path.

> See also: [Personal assistants](/guide/persona) · [Company groups](/guide/organize) ·
> [Tools](/guide/tools) · [Access controls](/guide/permissions)
