# Control who can access what

::: tip The golden rule
Assistants start with **no access**. Nothing — no skill, tool, or knowledge — is
available until you allow it. You open things up deliberately.
:::

There are two ways you control access, and they work together.

## 1. Grant skills, tools, and knowledge

When you [share a skill](/guide/skills), [connect a tool](/guide/tools), or
[add knowledge](/guide/knowledge), you decide **who gets it** — a single person, a
team, a department, or the whole org (the [scopes](/guide/organize) again).

A grant is just "allow *this* for *these* people." Grant the Sales department your CRM
tool; grant Engineering the code-review skill; keep a finance dataset to the finance
team. Widen or revoke at any time, and changes take effect almost immediately.

## 2. Set guardrails with an access policy

An **access policy** draws a boundary around what an assistant may reach on the
network — which external sites it can call, and which connected tools are off-limits.
It's your safety net, and its safest starting point is "block everything except what's
explicitly listed."

Manage policies through the authenticated `/api/v1/policies` endpoints. Use
`GET /api/v1/policies/drift` to inspect projection drift and
`POST /api/v1/policies/repair` to repair it; see the
[API overview → Access policies](/reference/api-overview#access-policies).

## Putting it together

> **Grants** decide *what an assistant can use*. **Policies** decide *where it's
> allowed to reach*. Together they keep every assistant scoped to exactly what its
> owner needs — and nothing more.

Every change here is recorded in the [audit log](/guide/audit).
