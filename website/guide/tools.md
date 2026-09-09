# Connect company tools

A **tool** lets an assistant ask for an action in another system, such as searching customer
records or updating a ticket. OpenCrane uses the Model Context Protocol (MCP) to describe these
integrations.

::: info Current scope
The catalogue, immutable package import and governed MCP execution services are implemented.
The continuation implementation lets the first model request select one frozen tool that requires
no approval. The server retains the declaration privately, checks the exact result and may request
a final text answer using the same key and remaining original allowance. This implementation in
PR #830 awaits CI and live qualification. Company assistant revisions still exclude tool
assignments, and testv5 has no installed integration for a complete retrieval proof. Installing a
tool alone does not make this journey available. Approvals, visible tool progress and recovery
controls remain unfinished. See [development status](/guide/status).
:::

## Prepare an integration

Administrators use the authenticated `/api/v1/mcp` surface to browse, install and manage MCP
definitions. Consult the [API reference](/reference/api) for current payloads and the
[OCI MCP guide](/integrators/oci-mcp-runtime) for the supported package format.

Decide which tools are needed, who may use them, and which actions require approval. Registration
alone does not grant access.

## The intended action journey

When the conversation integration is complete, an assistant will propose a tool call. OpenCrane
will check its permissions, request approval when required, execute the admitted action and return
a recorded result. The assistant will not approve its own action.

Revocation changes later permission decisions. It does not erase a record of an action that
already completed.

> See also: [Access controls](/guide/permissions) · [Review activity](/guide/audit) ·
> [Governed packages](/integrators/governed-packages)
