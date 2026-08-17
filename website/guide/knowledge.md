# Connect organisational knowledge

OpenCrane has the authority and schema foundations for governed semantic memory, but the live
product does not yet ingest knowledge into Cognee or return Cognee recall results to an agent. The
current administrator API manages a third-party source inventory; it is not a memory-ingestion API.

::: tip Current boundary
Personal dataset identity is bound to the verified silo, organisation and subject at admission.
That binding is live, but fact retrieval is not. Managed agents currently receive a memory policy
with scope `none`; organisation, department and project recall remain target capabilities.
:::

## Manage the source inventory

The authenticated `/api/v1/third-party-sources` API can list, create, update and delete source
records and their discovered-item metadata. Supported inventory kinds include MCP registries,
Anthropic Skills, Git repositories and manual uploads. The current UI does not expose this
administration surface.

An inventory record describes where knowledge may come from and its observed status. Creating one
does not ingest its content into Cognee, create a semantic-memory dataset, or make it available in a
run.

## Memory foundations

OpenCrane's memory catalogue models dataset identity, lifecycle, consent, sensitivity, provenance
and fact digests without duplicating fact text. A personal run can freeze the gateway-native dataset
coordinates selected from verified identity. The repository also contains an authenticated memory
gateway client and content-free catalogue commands, but neither the recall client nor a memory
writer is composed into the production server path.

## During a run

The runtime cannot select an arbitrary personal dataset. A personal agent may propose the
approval-required `memory_recall` action. OpenCrane verifies the exact participant permission and
one-use receipt, then stops with `safe_delivery_required` before calling Cognee. No recalled fact
content reaches the model. Managed agents receive no memory-recall scope, and memory writes remain
fail closed.

::: info Current memory-recall status
Run admission freezes only verified dataset coordinates, not a query, fact references or fact text.
These coordinates constrain a future read; they do not mean a read happened.
:::

::: warning
Do not treat a healthy source-inventory record, a frozen dataset coordinate or an approved
permission request as proof that content was ingested or recalled.
:::

## Going deeper

See [Memory write, manage and read](/integrators/retrieval-memory) for the current and target
memory loop, provenance, return boundaries and failure behaviour. See
[Long-term memory, Cognee and dreaming](/integrators/long-term-memory-cognee) for personal versus
organisation datasets, RBAC and governed consolidation.
