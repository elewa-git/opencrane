# Connect company tools

A **tool** lets an assistant work with another system, such as searching customer records or
updating a ticket. Your organisation chooses which integrations to install and which assistants
may use them.

::: info Current scope
The implementation can connect one permitted tool call that needs no approval to a final assistant
answer. Its automated tests pass; connection credentials and a live retrieval from a real integration
remain pending. Administrators can assign tools to a company assistant through the API. Personal chats
also have an implemented tool-phase display. These follow-ups have their own verification status.
See [development status](/guide/status) before treating the full journey as available in an installation.
:::

## Prepare an integration

OpenCrane uses the **Model Context Protocol (MCP)** to describe integrations. Its internal catalogue
stores definitions, immutable executable revisions and discovered tools. Administrators register and
govern definitions through the authenticated `/api/v1/mcp` surface. An entitled person can install a
catalogue entry for themselves through the API; the personal Tools screens are currently unmounted.
Consult the
[API reference](/reference/api) for current payloads and the [OCI MCP guide](/integrators/oci-mcp-runtime)
for the supported package format.

Choose the tools needed for the task, then grant access and assign them to the assistant.
Installation alone grants no access. A company assistant uses its own permissions; it does not
inherit everything the person asking the question may do. Its administrator can replace the
assigned tool set through the company-assistant API.

## Connection sharing is planned

A connection will identify the external account and keep its credential in protected storage. A
person can share use of a connection with an access group or assistant. Company-owned connections
will support shared accounts that remain manageable when an employee leaves. These connections,
credential handling and sharing controls are not implemented yet; current credential labels do not
establish that a secret has been configured.

Each connection must show a **Shared access** list beside **Share connection with…**. It will show
the recipient, direct or group-derived access, permitted tools/actions, expiry and status. An
authorized owner or administrator can **Revoke access** after confirming the connection and
recipient. The refreshed list must identify any access that remains through another valid share.
Sharing permits use without exposing the secret. Joining a group chat will not grant connection use.

Revocation will prevent the revoked share from authorizing new use, and queued work will recheck
access before execution. Requests already sent to an external system may finish; revocation does
not undo their effects. The access list and revocation are required parts of the connection feature.

## From a request to an answer

The server limits the model to the tools admitted for that task. When it selects one, OpenCrane
checks current access, executes the admitted call and checks the result before asking for a final
answer. The current continuation supports one tool that requires no approval.

Personal **Recent activity** can show the tool as queued, running, result received or needing
attention. Receiving a result does not mean the assistant has finished its answer. Inputs and raw
tool results are not shown in that activity row.

The full approval journey, company-chat progress and recovery controls remain unfinished. The
intended approval step will explain the proposed action and ask a person to decide; an assistant
will not approve its own action. Revocation changes later permission decisions without erasing
records of actions already completed.

> See also: [Access controls](/guide/permissions) · [How OpenCrane works](/guide/how-it-works) ·
> [Governed packages](/integrators/governed-packages)
