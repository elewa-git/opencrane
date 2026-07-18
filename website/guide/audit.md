# Review activity

::: tip What's in the audit log?
A record of every **administrative action** — who created or paused an assistant,
changed a policy, shared a skill, connected a tool, or adjusted a budget. It does
**not** record anyone's conversations with their assistant.
:::

## Look it up

Look up the most recent activity across your company, or everything about one
assistant, and feed the results into another tool if you like. Query the authenticated
`GET /api/v1/audit` endpoint; filters and cursor pagination are documented in the
[interactive API reference](/reference/api).

The log is kept accurate even if part of the system is briefly unavailable, so it's a
reliable record for reviews and compliance.
