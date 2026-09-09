# Ask an assistant in a group

Keep the discussion with your colleagues in a group chat. When a request needs assistant work,
open a linked chat with the company assistant, follow its answer there, and review what you want
to bring back to the group.

::: info Development baseline
This text-conversation flow has passed live testing with three employees in the test installation.
The newer tool and login-continuity changes have separate [qualification status](/guide/status).
An administrator must first [set up the company assistant](/guide/first-agent) and permit you to use it.
:::

## Start work from a message

1. Write your request in the group.
2. Choose **Ask company assistant** on your own message and select the available assistant.
3. Submit the request. **Pending** means the assistant chat is being prepared; use **Open** when
   it is ready. Retrying the same request does not create another chat.
4. Continue the discussion with the assistant in that chat. **Back to group** returns to the
   conversation that requested the work.

The child chat starts with the selected request. It does not receive the group's complete history
or anyone's personal assistant configuration. This includes personal preferences: the company
assistant uses its own instructions, even when the requester has a personalized assistant.
Sharing knowledge or delegating work must preserve that separation. Its audience is fixed to the group's current
participants when work is requested. Everyone included must be allowed to read that request;
a message from before somebody joined cannot be copied into a child shared with that person.

If creation becomes unavailable, the interface says so. It does not imply that the assistant
completed the work. A new request is a separate operation from retrying an existing one.

## Review and share a result

Choose **Share result to group** on a result in the assistant chat. Review and edit the text before
submitting it. The message is posted as you, with a link to its origin; the assistant cannot
silently post to the parent as a colleague.

The parent and child keep separate histories. Access to the parent alone does not grant access
to the child. Losing current access prevents later child reads and removes private content from
the selected browser view. Joining the group later does not add someone to an existing child.

## Delegation between assistants

An assistant autonomously assigning work to another assistant is a later capability. It needs
its own limits, cancellation and result ownership. The group flow above starts with a person's
explicit request and uses one company assistant; it does not provide recursive agent delegation.

> See also: [Company assistant](/guide/first-agent) · [Personal assistants](/guide/persona) ·
> [Access controls](/guide/permissions) · [Architecture](/advanced/architecture)
