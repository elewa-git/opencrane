# Control who can access what

Company permissions determine **who may use or manage each resource**. Giving a person access to
an assistant is different from giving that assistant access to a company system.

## Choose the person or group

Administrators can grant access to a person or company group. Departments, teams and projects use
the same group model; parent relationships determine which groups sit inside others.

A company group organises access. It is separate from a group conversation, which is a chat
between participants.

## Choose the resource and action

Decide what the recipient may read, use or manage, and whether the grant covers only the chosen
resource or its descendants. Avoid assuming that a group name or ownership alone supplies the
required permission.

OpenCrane's central permission checks are implemented. The complete administrative interface
remains unfinished; use the [API reference](/reference/api) for currently exposed operations.

## Change access

The server checks current permission before protected actions. Removing access affects later
decisions and must not be bypassed by an assistant's earlier configuration. Records of completed
actions remain available to authorised reviewers.

Agent-driven tool execution and shared-agent scheduling still need their complete product
journeys; permission infrastructure alone does not make those features available.

> See also: [Company groups](/guide/organize) · [Tools](/guide/tools) ·
> [Central authorisation](/integrators/authorization-authority) · [Development status](/guide/status)
