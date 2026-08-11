# Connect organisational knowledge

Give agents something worth remembering. OpenCrane keeps a durable memory store (backed by
Cognee) behind its own access control, so what an agent can recall always matches what its owner
is allowed to see — never a raw, ungoverned document dump.

::: tip Personal memory vs shared knowledge
Your [personal assistant](/guide/persona) recalls from **your own** personal dataset — no one
else's assistant can read it, and it can't read anyone else's. A managed agent recalls only from
the **shared** organisation, department or project knowledge it was explicitly configured with.
Neither kind can wander into the other's memory.
:::

## Register sources and datasets

Register the organisation's supported sources through the current API. The current UI does not
expose knowledge management. Place content in datasets whose scope matches the intended
audience: personal, project, department or organisation.

## Grant access

Grant both the acting subject and the agent service the required dataset capability. OpenCrane
resolves those grants before admission and freezes the selected memory policy in the
`RunInputSnapshot`.

## During a run

The runtime cannot select an arbitrary dataset. Memory actions pass through OpenCrane, which
derives personal dataset identity from the verified silo, organisation and subject, then
records provenance for durable facts.

::: info
Reads are live: run admission freezes gateway-selected fact references (id and content digest only)
into the `RunInputSnapshot`, and prompt compilation inlines each statement only after verifying it
against the frozen digest. Mid-run memory actions can use the durable server-worker result channel;
every write remains fail closed until its durable recovery lifecycle exists.
:::

::: warning
Do not use dataset names as the security boundary. Membership and grants decide access; a
caller-provided dataset parameter cannot widen it.
:::

## Going deeper

See [Retrieval and memory](/integrators/retrieval-memory) for fact provenance, personal
dataset binding and failure behaviour.
