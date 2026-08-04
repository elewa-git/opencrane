# Connect organisational knowledge

OpenCrane uses **Cognee-backed datasets** for durable memory and keeps access, provenance
and dataset identity under control-plane governance.

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
against the frozen digest. Mid-run memory actions and every write remain fail closed — recalled
text still has no safe, attempt-fenced ephemeral result channel, and no durable write lifecycle
exists yet.
:::

::: warning
Do not use dataset names as the security boundary. Membership and grants decide access; a
caller-provided dataset parameter cannot widen it.
:::

## Going deeper

See [Retrieval and memory](/integrators/retrieval-memory) for fact provenance, personal
dataset binding and failure behaviour.
