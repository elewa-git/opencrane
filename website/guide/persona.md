# Set up your personal assistant

Your **personal assistant** helps with your work. Onboarding records how you would like it to
respond, then asks you to review and approve those preferences.

## Complete the setup

1. **Sign in** at your organisation's OpenCrane address.
2. **Answer the interview questions** about your role, working habits and preferred style. You can
   return to an unfinished interview without starting over.
3. **Review the draft persona.** A persona is the saved description of how your assistant should
   behave. The draft includes a small set of insights linked to your answers.
4. **Approve the draft.** Approval saves the reviewed persona and prepares your personal
   assistant's first configuration.
5. **Open a conversation** to begin working with the assistant.

::: info Development status
The interview, persona review, assistant-configuration handoff and forwarding of approved
instructions to the model are implemented in the review baseline. The complete live
onboarding-to-conversation journey still needs qualification. See [development status](/guide/status).
:::

## What approval means

You approve the description shown to you. It does not grant extra access to company systems or
change your spending permissions. Your organisation's controls continue to apply.

The saved interview and persona let you review where the preferences came from. Technical version
and transaction details are part of the implementation, not steps you need to manage.

## Changing preferences

The current persona workflow starts a new interview for a refresh and keeps the previous approved
version until the replacement is accepted. A direct editable persona-file experience is not part
of the current product.

## Personal and shared assistants

A personal assistant uses your approved preferences. A [shared agent](/guide/first-agent) uses its
own approved role, instructions and permissions. Group and shared agents must not inherit anyone's
personal preferences, whether that person creates the agent, requests work or delegates to it.

They can use permitted [knowledge](/guide/knowledge) and follow explicit instructions for the
current task within their own configuration and permissions. A shared style is configured
separately by an authorized owner. The current [group-assistant journey](/guide/child-runs) already
excludes personal assistant configuration; broader delegation remains planned.

> See also: [How OpenCrane works](/guide/how-it-works) ·
> [Knowledge and memory](/guide/knowledge) · [Access controls](/guide/permissions)
