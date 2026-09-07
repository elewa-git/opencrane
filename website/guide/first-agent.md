# Set up the company assistant

A company assistant helps colleagues in a [chat linked to their group](/guide/child-runs).
It has its own identity and model permission. It does not inherit the administrator's private
assistant, memory or tools.

::: info Current scope
The 0.11 review baseline supports one explicitly provisioned company assistant per organisation,
with text answers and follow-up questions. Setup currently uses the authenticated administrator
API. Scheduling, automatic triggers, tools and delegation between assistants remain future work.
:::

## Choose who can use it

The administrator selects a name, an existing model definition and the exact current employee
principals who may use the assistant. The administrator needs permission to administer the
organisation and use that model. Employees receive permission to discover, read and invoke the
assistant; the assistant receives its own permission to use the selected model.

The deployment supplies the computer profile and execution limits. The first company assistant
uses one model turn per request, with ceilings of 32,000 completion tokens and two minutes. Those per-request
limits are separate from company spending controls.

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

## Try it with colleagues

An allowed employee opens a group, writes a request and chooses **Ask company assistant**. Check
that the child chat produces an answer, survives refresh, and allows a person to review and share
a result back. Include an employee without permission in your access tests. These complete
journeys still need live qualification for the current review baseline.

> See also: [Ask an assistant in a group](/guide/child-runs) ·
> [Personal-assistant setup](/guide/persona) · [Access controls](/guide/permissions)
