# Company knowledge and personal memory

**Company knowledge** gives an assistant information it may use for work. **Personal memory** is
useful context it retains about one person's preferences or ongoing tasks between conversations.

::: info Still being completed
OpenCrane has memory metadata, permission and gateway foundations, but the current personal
conversation path does not provide a complete remember, recall, correct and forget journey.
Shared organisation-memory workflows also remain product work. See [development status](/guide/status).
:::

## Keep the two purposes separate

Company knowledge might include product information or approved internal documentation.
Personal memory might include a person's preferred answer format or the context of their work.

Neither should become available just because it was uploaded or mentioned. The completed product
must make clear who can use the information, what was retained and how to change or remove it.

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
