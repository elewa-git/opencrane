# Knowledge and personal preferences

**Knowledge** is information an assistant may use for work: project decisions, contract terms,
documents or the context of an ongoing task. Knowledge can be private to one person or shared with
an authorized audience.

**Personal preferences** describe how you want your personal assistant to work: language, tone,
answer length or working style. Remembering information and personalizing behaviour are different
product capabilities, even when both persist between conversations.

::: info Still being completed
OpenCrane has memory metadata, permission and gateway foundations, but the current personal
conversation path does not provide a complete remember, recall, correct and forget journey.
Shared organisation-memory workflows also remain product work. See [development status](/guide/status).
:::

## Give shared agents their own configuration

Group and shared agents use their own approved role, instructions and permissions, together with
knowledge they are allowed to read. They must not inherit the personal preferences of their
creator, requester or group members, including when a personal assistant delegates work to them.

For example, a shared agent may use an authorized project deadline. It does not also receive your
preference for informal, short answers. Asking it in the group to “summarize this in three bullets”
is an instruction for that task; it does not load or update your personal profile. An authorized
owner can separately configure a team-wide style for the shared agent.

Sharing knowledge or a connection does not share personal preferences. A preference cannot become
shared-agent behaviour merely by being labelled as knowledge. The completed product must show
what was retained, who can use it and how to correct or remove it. This distinction does not
authorize automatic storage or publication into a group.

## Source inventory

Administrators can manage source records through the authenticated
`/api/v1/third-party-sources` API. These records describe potential sources and discovered-item
metadata; they do not by themselves ingest content or make it available to an assistant.

Use the [API reference](/reference/api) for the current management contract.

## What remains

The product needs complete user journeys for adding useful context, recalling it in a later
conversation, inspecting what was remembered, and correcting or forgetting it. A healthy memory
service or saved source record does not demonstrate those outcomes.

> See also: [Personal-assistant setup](/guide/persona) · [Access controls](/guide/permissions) ·
> [Memory architecture](/integrators/retrieval-memory)
