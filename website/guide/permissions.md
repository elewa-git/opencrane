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

## Remove a company member

The current follow-up adds **Remove access** to **Settings → Members** for standalone installations.
An authorised administrator chooses another active member, reviews the confirmation and removes
that person's access. The member remains listed as suspended so the organisation retains the record.
The interface explains why an unavailable action cannot be used; people cannot remove themselves
or the organisation Owner. Fleet-managed removal remains unsupported.

Protected product requests check the member's current status. An open chat clears its cached list,
history, draft and onboarding transcript when access loss is detected. Existing live subscriptions
check authority every ten seconds; detection is therefore bounded rather than instantaneous.
Delayed requests cannot restore the cleared content. Removing membership does not delete the
organisation's conversation history or restore access through an old invitation.

This follow-up is under review. Its real-account removal journey is still awaiting live
qualification; see [Development status](/guide/status).

Agent-driven tool execution and shared-agent scheduling still need their complete product
journeys; permission infrastructure alone does not make those features available.

> See also: [Company groups](/guide/organize) · [Tools](/guide/tools) ·
> [Central authorisation](/integrators/authorization-authority) · [Development status](/guide/status)
