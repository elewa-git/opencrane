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
Durable conversation history, bounded personal model turns and computer inspection are implemented
in the 0.11 review baseline. Agent-driven tool use, the complete approval journey and durable
created-output journeys remain unfinished. See [development status](/guide/status) before treating
the sequence above as an available end-to-end workflow.
:::

## Returning to work

The browser displays a saved conversation. Closing a tab does not make the browser responsible for
remembering it. An assistant's computer can also stop when idle; checkpoint and restore code keeps
its workspace recoverable. Live recovery testing remains part of qualification.

## Working with other people

The conversation model also supports direct and group messages. Ordinary messages between people
do not ask an assistant to run. You can explicitly [ask the company assistant](/guide/child-runs)
from one of your group messages, continue in a linked chat, and review a result before sharing it back.
Delegation between assistants remains planned.

A shared agent is intended for a repeatable company task with its own access. Its scheduled and
triggered execution is not yet part of the current working product. Read
[shared agents](/guide/first-agent) for that distinction.

## Follow personal tool work

Recent activity keeps the assistant's work status and its latest tool phase separate. A tool may be
queued, running, have returned its result, or need attention while the assistant is still working.
A received result does not mean the answer is finished: **Open answer** appears only when the saved
final message is loaded and readable in the selected conversation.

**Refresh activity** reads the current status. It does not repeat the tool call or start another run.
Changing chats or losing access clears the previous chat's rows. This view contains no tool arguments,
result content or connection credentials. Company-child receipts and complete action controls remain
part of the [remaining work](/guide/status#still-to-complete).

> See also: [Set up your personal assistant](/guide/persona) ·
> [Tools](/guide/tools) · [Knowledge and memory](/guide/knowledge) ·
> [Architecture](/advanced/architecture)
