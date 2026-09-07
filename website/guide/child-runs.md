# Delegating work between assistants

The product vision includes **delegation**: an assistant asks a specialist agent to handle part of
a task and brings the result back to the original conversation.

::: info Planned
Agent-to-agent delegation and group `@agent` child conversations are not complete in the 0.11
product. Existing run-tree contracts are infrastructure for that work, not an available user
journey. See [development status](/guide/status).
:::

## Two different experiences

**An assistant delegates part of your task.** You keep working in the original conversation while a
specialist handles a bounded piece of work. The intended result is returned with enough context to
understand what was done.

**A group asks an assistant to help.** An `@agent` message is intended to open a separate assistant
conversation linked to the group. The group and assistant conversation keep their own history and
participants. Ordinary group messages already have a different purpose: communication between
people, without starting assistant work.

These are separate product capabilities. Implementing one does not establish the other.

## What the completed product must make clear

- Which task was delegated and which agent is handling it.
- Which information was shared and which actions are permitted.
- Whether a decision is needed, the work failed or a result is ready.
- Where to find the result in the conversation that requested it.

Delegation must not silently broaden access or expose private conversation history.

> See also: [How OpenCrane works](/guide/how-it-works) · [Shared agents](/guide/first-agent) ·
> [Access controls](/guide/permissions) · [Architecture](/advanced/architecture)
