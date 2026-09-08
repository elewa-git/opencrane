# Development status

OpenCrane is **pre-MVP**. This page distinguishes implemented capabilities in the 0.11 review
baseline from remaining product work and live verification.

## Built in the review baseline

| Capability | What is implemented |
|---|---|
| Company membership and access | Sign-in, membership evidence, groups and central permission checks. The user interface does not yet expose every administrative operation. |
| Personal-assistant setup | A resumable interview, reviewed persona and creation of the first personal assistant configuration. |
| Durable conversations | Creation, posting and history reads, including ordinary direct/group messages and personal assistant conversations. History is stored in KurrentDB. All three modes distinguish a new chat from a retried creation command. |
| Recognizable chats | Member display names in the participant picker and direct/group chat titles, with generic text for missing names. |
| Live conversation updates | Bounded, resumable browser events with current access checks. Revocation clears the selected history and draft, and late responses cannot restore them. The event stream supplies message history and live changes; computer inspection refreshes separately. |
| Personal model turns | Approved persona instructions and conversation history feed a bounded model request; its assistant output is persisted against the admitted conversation computer. New runs explicitly exclude personal memory while provisioning and recall remain unfinished. |
| Company assistant in groups | Explicit assistant selection on an own group message, recoverable child creation, fixed audience, current parent and child access checks, follow-up answers, and human-reviewed sharing back. Administrator setup uses the API. |
| Computer inspection | Workspace file, diff and browser discovery routes. Commands, page creation, screenshots and preview actions remain denied until their concrete effect admissions are connected. |
| Computer recovery | Retrying failed starts, renewing or replacing active computers, and saving and restoring workspaces. |
| History operations | Scheduled backups, restore tooling and health checks. Live scheduled file copies and restricted anonymous health pass; restoring a completed product fixture and measuring recovery time remain pending. |

These are implementation claims, not a claim that every journey is deployed, merged or live
qualified. The [active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) records the
current review work and its evidence.

## Still to complete

- **Useful work across tools:** connect the conversation model loop to governed tool execution,
  approvals and durable results, then prove a real business task from start to finish.
- **Personal memory:** complete remembering, recalling, correcting and forgetting information
  across conversations.
- **Shared work:** restore supported managed-agent scheduling and triggered execution, and complete
  delegation between assistants.
- **Inputs and outputs:** complete the user journeys for attachments, generated files and their
  recovery across refresh, retry and conversation closure.
- **Administration:** complete the product surfaces for permissions, activity and cost without
  requiring an employee to understand internal execution concepts.
- **Login continuity:** preserve authenticated sessions across server replacement and support
  multiple servers consistently. The current server stores sessions in its own process, so a
  replacement requires people to sign in again even though their saved conversations remain.

Durable application source, builds and published apps are later work. Temporary computer previews
do not publish an application.

## Still to prove live

The test installation has verified real identity-provider login, invitation admission, provider
configuration and a three-person group with durable ordered messages and idempotent retries.
Five test employees have completed guided onboarding. After deploying the profile and standalone
membership repairs, a fresh employee signed in with a password in a real browser and reached the
chat workspace with their assistant ready. Company-assistant discovery, administrator checks and
child-request admission also pass, including audience isolation and retry checks.

Fresh personal chats and company-assistant requests now reach their running computers. Private
networking and activation replay have passed remote qualification and are deployed. A fresh company
request was selected in the real browser, and all three group members can open its child chat.
The server's narrow Pod-read permission is qualified and deployed: a fresh personal computer
obtained its review credential and restored its workspace. Run admission then refused the first
turn. The next repair corrects the onboarding persona identity lookup and the distinction between
the human requester and company executor, and removes unfinished memory provisioning as a
prerequisite for text turns. Complete personal and child answers, reviewed sharing and reconnect
remain pending live.

Access changes, recovery and computer actions need their complete live journeys. Tool, memory and
shared-work journeys need their own evidence as they become available. Both history restore modes
still need a completed product fixture and measured recovery time.

Component tests, a chart render or a healthy process do not establish those complete journeys.
Conversely, a pending live drill does not make already implemented code unfinished. Deployment
evidence belongs in the
[deploy ledger](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).

> See also: [What is OpenCrane?](/guide/introduction) ·
> [Architecture](/advanced/architecture) · [Installation](/guide/getting-started)
