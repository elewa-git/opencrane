# Set up the company assistant

A **company assistant** helps colleagues in a [chat linked to their group](/guide/child-runs).
This page covers administrator setup, employee access and selection of the tools it may use.

::: info Current scope
The review branch supports one company assistant per organisation, with text answers, follow-up
questions and exact tool selection through the authenticated administrator API. There is no
management screen yet. Company credential activation and a complete live retrieval journey remain
unfinished. See [development status](/guide/status) for the current implementation and live evidence.
:::

## Choose who can use it

The administrator selects a name, an existing model definition and the exact current employee
principals who may use the assistant. The administrator needs permission to administer the
organisation and use that model. Employees receive permission to discover, read and invoke the
assistant; the assistant receives its own permission to use the selected model.
It has its own identity and does not inherit the administrator's private assistant, memory or tools.

The deployment supplies the computer profile and execution limits. Newly created company assistants
permit at most two model requests, so one tool result can inform a final answer, within one shared
turn allowance of 32,000 completion tokens and two minutes. These limits are separate from company spending
controls. Editing an existing assistant's tools preserves its original allowance.

## Create it through the API

Use your authenticated browser session to send this command to
`POST /api/v1/organization/company-assistant`. The identifiers below are placeholders for your
installation's model definition and explicitly selected employee Principals.

```json
{
  "name": "Company assistant",
  "modelDefinitionId": "your-model-definition-id",
  "invokerPrincipalIds": ["employee-principal-id", "another-employee-principal-id"]
}
```

A successful creation returns `201` with the assistant's identifier and display name. If a network
failure interrupts setup, repeat the same request. The server recovers the existing identity;
it does not create another assistant. A `200` response means the existing configuration was
retained, so different values in a retried body do not rename it or change its grants.

A suspended or retired assistant is never reopened by repeating setup. Manage access through the
company's existing permission controls. Check the [API reference](/reference/api) for the exact
request schema and failure responses.

## Choose its tools

Read `GET /api/v1/organization/company-assistant/tools`, then send the complete desired selection
to `PUT /api/v1/organization/company-assistant/tools`:

```json
{
  "expectedActiveRevisionId": "revision-returned-by-the-read",
  "toolRevisionIds": ["ready-tool-revision-id"]
}
```

The response identifies the assistant, its active configuration revision and the selected tools.
Select up to 32 unique tool revisions; an empty list removes all assignments. You need permission
to administer the organisation and assign each selected tool. Every tool must belong to your
organisation and a ready revision of an active, published server. An unchanged selection still
checks those permissions and does not restore revoked grants.

A changed selection creates an immutable revision: the previous configuration remains recorded.
Use the returned `activeRevisionId` for your next edit. If you receive `409`, another edit has changed
the active revision; read the configuration again before replacing it. After an uncertain response,
also read the current configuration instead of assuming the edit failed.

The assistant receives its own Use and Invoke permissions for the exact selected tools. Removing
a tool withdraws the grants managed by this configuration and prevents further dispatch through
the old revision. It cannot undo an external action already started. Assignment does not raise the
model limit: an existing one-request configuration cannot make a second request to answer from a
tool result.

::: warning Assignment is not a connected integration
This API selects tools and permissions; it does not install an integration or activate credentials.
The assistant never falls back to an employee's private credentials. A dedicated integration still
needs live retrieval proof. The current continuation supports one tool that needs no approval;
approved external changes and visible tool progress remain unfinished.
:::

→ [Prepare a company integration](/guide/tools).

## Try it with colleagues

An allowed employee opens a group, writes a request and chooses **Ask company assistant**. Check
that the child chat produces an answer, survives refresh, and allows a person to review and share
a result back. Include an employee without permission in your access tests. The earlier text-only
journey passed in testv5; repeat it for the candidate being installed. Tool assignment does not
establish the separate live retrieval proof.

> See also: [Ask an assistant in a group](/guide/child-runs) ·
> [Personal-assistant setup](/guide/persona) · [Access controls](/guide/permissions)
