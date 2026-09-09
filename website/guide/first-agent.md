# Set up the company assistant

A company assistant helps colleagues in a [chat linked to their group](/guide/child-runs).
It has its own identity and model permission. It does not inherit the administrator's private
assistant, memory or tools.

::: info Current scope
The 0.11 review baseline supports one explicitly provisioned company assistant per organisation,
with text answers and follow-up questions. Setup currently uses the authenticated administrator
API. The follow-up adds assignment of existing tools, but its complete retrieval journey still
needs live qualification. Scheduling, automatic triggers and delegation between assistants remain
future work.
:::

## Choose who can use it

The administrator selects a name, an existing model definition and the exact current employee
principals who may use the assistant. The administrator needs permission to administer the
organisation and use that model. Employees receive permission to discover, read and invoke the
assistant; the assistant receives its own permission to use the selected model.

The deployment supplies the computer profile and execution limits. The first company assistant
has ceilings of 32,000 completion tokens and two minutes per request. Fresh provisioning permits at most two model requests so a tool result can feed a final answer,
within the same total token and time ceilings. These limits are
separate from company spending controls.

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

An administrator can read the current assignment with
`GET /api/v1/organization/company-assistant/tools`, then send the complete desired list to
`PUT /api/v1/organization/company-assistant/tools`:

```json
{
  "expectedActiveRevisionId": "revision-returned-by-the-read",
  "toolRevisionIds": ["installed-tool-revision-id"]
}
```

The response identifies the assistant, its active revision and the selected tools. Use the new
revision identifier for the next edit. A `409` response means the saved configuration changed;
read it again before deciding what to replace. After an uncertain response, read the current
configuration rather than assuming the edit failed. An empty list removes all tool assignments. Assignment preserves the assistant's existing
budget. An earlier configuration limited to one model request therefore remains text-only;
assigning tools does not silently raise that limit.

You need organisation administration permission and permission to assign every selected tool.
Tools must already be ready in this installation. The assistant receives its own Use and Invoke
permissions for those exact tools. Removing an assignment withdraws the permissions managed by
this configuration and prevents further dispatch through the superseded revision. It cannot
cancel an external effect that was already dispatched.

This API configures permission; it does not install an integration or activate credentials.
Select and qualify a dedicated integration before claiming the assistant can retrieve its data.
The current continuation supports one tool that requires no approval. Approved changes and
visible tool progress are still in development.

## Try it with colleagues

An allowed employee opens a group, writes a request and chooses **Ask company assistant**. Check
that the child chat produces an answer, survives refresh, and allows a person to review and share
a result back. Include an employee without permission in your access tests. These text journeys passed in testv5. Repeat them with one permitted tool after installing the
qualified follow-up; the tool journey has not yet passed live qualification.

> See also: [Ask an assistant in a group](/guide/child-runs) ·
> [Personal-assistant setup](/guide/persona) · [Access controls](/guide/permissions)
