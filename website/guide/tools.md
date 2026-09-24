# Connect company tools

A **tool** lets an assistant ask for an action in another system, such as searching customer
records or updating a ticket. OpenCrane uses the Model Context Protocol (MCP) to describe these
integrations.

::: info Current scope
The catalogue, immutable package import and governed MCP execution services are implemented.
The server can select one frozen tool that needs no approval, retain its result privately and make
at most one final text request within the original remaining allowance. Absurd durably advances
this work. Administrators can [assign exact tools to the company assistant](/guide/first-agent#choose-its-tools)
through the API. Credential activation and a complete live retrieval proof remain unfinished.
Installing or assigning a tool alone does not establish a working connection. Approvals, visible
tool progress and recovery controls remain unfinished. See [development status](/guide/status).
:::

## Prepare an integration

Administrators use the authenticated `/api/v1/mcp` surface to browse, install and manage MCP
definitions. Consult the [API reference](/reference/api) for current payloads and the
[OCI MCP guide](/integrators/oci-mcp-runtime) for the supported package format.

Decide which tools are needed, who may use them, which company connection owns their credentials,
and which actions require approval. Registration alone does not grant access. A `credentialless`
install needs no provider credential, but that status alone does not prove a provider call works.
Servers that need a Principal or shared organisation credential remain unavailable until the
separate credential activation journey is implemented.

## The intended action journey

The implemented continuation can propose one tool call that needs no approval, check current
permissions, execute it and use its recorded result in an answer. A tool that requires human
approval still needs the review-and-execution journey. The assistant will not approve its own action.

Revocation changes later permission decisions. It does not erase a record of an action that
already completed.

> See also: [Access controls](/guide/permissions) · [Review activity](/guide/audit) ·
> [Company assistant](/guide/first-agent) · [Governed packages](/integrators/governed-packages)
