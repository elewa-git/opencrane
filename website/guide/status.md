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
| History operations | Scheduled backups, restore tooling and health checks. A scheduled file-copy restore recovered completed personal/group chats, removed a later message and allowed new group messages and an assistant answer. Scheduled volume snapshots are ready; restoring them remains unqualified. |

These are implementation claims, not a claim that every journey is deployed, merged or live
qualified. The [active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) records the
current review work and its evidence.

## Still to complete

- **Useful work across tools:** connect the conversation model loop to governed tool execution,
  approvals and durable results, then prove a real business task from start to finish. The next
  implementation rechecks current access before a queued tool call starts; its guard alone does
  not enable a model tool call or establish a live integration journey.
- **Personal memory:** complete remembering, recalling, correcting and forgetting information
  across conversations.
- **Shared work:** restore supported managed-agent scheduling and triggered execution, and complete
  delegation between assistants.
- **Inputs and outputs:** complete the user journeys for attachments, generated files and their
  recovery across refresh, retry and conversation closure.
- **Administration:** complete the product surfaces for permissions, activity and cost without
  requiring an employee to understand internal execution concepts. The follow-up implementation
  gives people read access to each new personal run when it starts. Two new testv5 runs now appear
  in their owners' activity API and remain invisible to the other employee. The follow-up UI adds
  recent status, refresh and links to loaded answers. Fresh browser checks now pass for both
  employees, including keyboard navigation, narrow screens and recovery after reload.
  Existing older runs receive no backfill. Revoked access is checked on every read.
- **Login continuity:** preserve authenticated sessions across server replacement and support
  multiple servers consistently. The follow-up implements encrypted PostgreSQL sessions with
  fixed expiry and logout protection. CI and fresh PostgreSQL tests pass; fresh-install live
  qualification remains pending. The current
  testv5 server uses process-local sessions and requires a new sign-in after replacement.

Durable application source, builds and published apps are later work. Temporary computer previews
do not publish an application.

## Proven in the test installation

Five test employees completed sign-in and guided onboarding with approved assistant settings.
Two employees independently received personal-assistant answers and recovered those saved answers
after signing in through a fresh browser and reloading the page. The completed runs used each
employee's approved settings and the configured model.

Each employee can also see a newly completed run in Recent activity and open its saved answer.
Refreshing activity does not start another run. The answer and activity survive reload; keyboard
navigation focuses the answer and closes the activity overlay on a narrow screen. Each employee's
private activity and history remain inaccessible to the other employee.

Three colleagues exchanged ordered group messages. The owner selected a company assistant on a
group message, and all three members could open its linked chat. The assistant answered the request
and a follow-up. In the browser, the owner returned to the group, reopened the assistant chat,
reviewed and edited its answer, and shared it back as their own message. That result survived reload.
Creation and posting retries, audience isolation and resuming live updates also passed.

These checks ran on the 0.11 review candidate in the dedicated testv5 installation. They establish
the text-conversation journey; they do not establish the unfinished tool, memory or autonomous
delegation journeys.

## Next live checks

The requested file-copy recovery and snapshot-backup checks have passed. Restoring a volume snapshot
would be a separate qualification. Membership revocation and clearing private browser state after
access is removed remain unproven live because the administrative operation is not yet exposed.
Computer actions need their complete journeys as their effect admissions become available.

Component tests, a chart render or a healthy process do not establish those complete journeys.
Conversely, a pending live drill does not make already implemented code unfinished. Deployment
evidence belongs in the
[deploy ledger](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).

> See also: [What is OpenCrane?](/guide/introduction) ·
> [Architecture](/advanced/architecture) · [Installation](/guide/getting-started)
