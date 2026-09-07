# Development status

OpenCrane is **pre-MVP**. This page distinguishes implemented capabilities in the 0.11 review
baseline from remaining product work and live verification.

## Built in the review baseline

| Capability | What is implemented |
|---|---|
| Company membership and access | Sign-in, membership evidence, groups and central permission checks. The user interface does not yet expose every administrative operation. |
| Personal-assistant setup | A resumable interview, reviewed persona and creation of the first personal assistant configuration. |
| Durable conversations | Creation, posting and history reads, including ordinary direct/group messages and personal assistant conversations. History is stored in KurrentDB. |
| Personal model turns | Approved persona instructions and conversation history reach a bounded model request; its assistant output is persisted against the admitted conversation computer. |
| Computer inspection | Workspace files, diffs, bounded commands, screenshots and temporary localhost previews through the conversation workspace. |
| Computer recovery | Retrying failed starts, renewing or replacing active computers, and saving and restoring workspaces. |
| History operations | A backup schedule, restore command and health checks. Backup/restore evidence currently covers chart rendering and a simulated restore script. |

These are implementation claims, not a claim that every journey is deployed, merged or live
qualified. The [active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) records the
current review work and its evidence.

## Still to complete

- **Useful work across tools:** connect the conversation model loop to governed tool execution,
  approvals and durable results, then prove a real business task from start to finish.
- **Personal memory:** complete remembering, recalling, correcting and forgetting information
  across conversations.
- **Shared work:** restore supported managed-agent scheduling and triggered execution, and build
  group `@agent` conversations and delegation.
- **Inputs and outputs:** complete the user journeys for attachments, generated files and their
  recovery across refresh, retry and conversation closure.
- **Administration:** complete the product surfaces for permissions, activity and cost without
  requiring an employee to understand internal execution concepts.

Durable application source, builds and published apps are later work. Temporary computer previews
do not publish an application.

## Still to prove live

The current baseline needs one real installation to prove login, onboarding, personal conversation,
model response, recovery and computer review together. Tool, memory and shared-work journeys need
their own live evidence as they become available. KurrentDB backup and restore also need a real
drill and measured recovery time.

Component tests, a chart render or a healthy process do not establish those complete journeys.
Conversely, a pending live drill does not make already implemented code unfinished. Deployment
evidence belongs in the
[deploy ledger](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).

> See also: [What is OpenCrane?](/guide/introduction) ·
> [Architecture](/advanced/architecture) · [Installation](/guide/getting-started)
