# Create your first employee assistant

::: tip What's an employee assistant?
A private AI coworker for one person. It has its own secure storage and its own web
address, and it acts on that person's behalf. (In the API it's called a
*tenant*.)
:::

## Create one

```bash
curl --fail-with-body \
  --request POST "$OPENCRANE_URL/api/v1/tenants" \
  --header "Authorization: Bearer $OPENCRANE_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"alice","displayName":"Alice Smith","email":"alice@example.com"}'
```

That's it — Alice's assistant is now live. She can [sign in and use](/guide/connect) it
at your organisation's address (e.g. `https://acme.<your-domain>`).

You can also set a few things up front — which team she belongs to (see
[Organize your company](/guide/organize)) and a monthly spend cap (see
[Manage cost](/guide/budgets)).

## Manage assistants

Once created, you can list everyone's assistants, look up one person's details, pause
an assistant to free resources, bring it back, or remove it altogether. Use the
authenticated `/api/v1/tenants` endpoints; see the
[API overview → Tenants](/reference/api-overview#tenants).

## What's next

A brand-new assistant starts locked down — it can chat, but it can't reach company
tools, skills, or knowledge until you allow it. Build it up:

- **[Let Alice sign in](/guide/connect)**
- **[Share skills with her](/guide/skills)** — reusable abilities
- **[Connect tools](/guide/tools)** — Slack, Jira, your CRM
- **[Add company knowledge](/guide/knowledge)** — so it answers with real facts
- **[Control access](/guide/permissions)** — decide exactly what it can use

The current request and response schemas live in the [interactive API reference](/reference/api).
