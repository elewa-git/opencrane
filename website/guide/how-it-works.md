# How OpenCrane works

An OpenCrane **conversation** is the place to start work and return to it later. Your assistant's
saved configuration and the company's permissions determine how it may help.

## The experience we are building

1. **Ask for help.** Open a conversation with your assistant and describe the outcome you want.
2. **Work with permitted context.** The assistant uses the model, knowledge, files and tools
   available for that task.
3. **Review consequential actions.** When an action needs your approval, the request explains what
   would happen before you decide.
4. **Keep the outcome.** Answers and completed outputs belong with the conversation so you can
   inspect them and continue the work later.

::: info Current scope
Personal and group text conversations, company-assistant replies and saved-answer activity have
passed live testing. One permitted tool call followed by an answer is implemented and tested, but
still needs a live integration proof. The complete approval and durable created-output journeys
remain unfinished. [Development status](/guide/status) separates source, tests and live availability.
:::

## Returning to work

The browser displays a saved conversation. Closing a tab does not make the browser responsible for
remembering it. An assistant's computer can also stop when idle; checkpoint and restore code keeps
its workspace recoverable. Live recovery testing remains part of qualification.

## Follow assistant work

Open **Recent activity** in a personal assistant conversation to see its work and reopen a saved
answer. The implemented tool-progress display adds a short description of the latest tool in the current
attempt: **Tool queued**, **Tool running**, **Tool result received** or **Tool needs attention**.
The overall work status remains visible separately. A received tool result means the assistant has
input to work with; it may still be preparing its answer.

Activity refreshes briefly while it is open. Use **Refresh activity** to check again later. The description
contains no tool inputs or results, and **Open answer** continues to refer to a saved answer in
that conversation. Signing out, changing conversations or losing access clears the activity.
Approval, retry and cancellation controls remain separate work; a needs-attention label does not
supply those controls. See [development status](/guide/status) for installation and live proof.

## Working with other people

The conversation model also supports direct and group messages. Ordinary messages between people
do not ask an assistant to run. You can explicitly [ask the company assistant](/guide/child-runs)
from one of your group messages, continue in a linked chat, and review a result before sharing it back.
Delegation between assistants remains planned.

The company assistant is a shared assistant with its own access. Running shared assistants on a
schedule or from automatic triggers is not yet part of the current working product. Read
[shared agents](/guide/first-agent) for that distinction.

> See also: [Set up your personal assistant](/guide/persona) ·
> [Tools](/guide/tools) · [Knowledge and memory](/guide/knowledge) ·
> [Architecture](/advanced/architecture)
