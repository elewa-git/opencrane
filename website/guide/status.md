# Development status

OpenCrane is **pre-MVP**. This page distinguishes implemented capabilities in the 0.11 review
baseline and follow-up PRs from remaining product work and live verification.

## Built in the review baseline

| Capability | What is implemented |
|---|---|
| Company membership and access | Sign-in, membership evidence, groups and central permission checks. The user interface does not yet expose every administrative operation. |
| Personal-assistant setup | A resumable interview, reviewed persona and creation of the first personal assistant configuration. |
| Durable conversations | Creation, posting and history reads, including ordinary direct/group messages and personal assistant conversations. History is stored in KurrentDB. All three modes distinguish a new chat from a retried creation command. |
| Recognizable chats | Member display names in the participant picker and direct/group chat titles, with generic text for missing names. |
| Live conversation updates | Bounded, resumable browser events with current access checks. Revocation clears the selected history and draft, and late responses cannot restore them. The event stream supplies message history and live changes; computer inspection refreshes separately. |
| Personal model turns | Approved persona instructions and conversation history feed a bounded text request. The server keeps model input and keys and saves the answer for restart. Text checkpoint `378a755b6` has passed full CI; live qualification of that replacement remains outstanding. New runs explicitly exclude personal memory while provisioning and recall remain unfinished. |
| Company assistant in groups | Explicit assistant selection on an own group message, recoverable child creation, fixed audience, current parent and child access checks, follow-up answers, and human-reviewed sharing back. Administrator setup uses the API. |
| Computer inspection | Workspace file, diff and browser discovery routes. Commands, page creation, screenshots and preview actions remain denied until their concrete effect admissions are connected. |
| Computer recovery | Retrying failed starts, renewing or replacing active computers, and saving and restoring workspaces. |
| History operations | Scheduled backups, restore tooling and health checks. A scheduled file-copy restore recovered completed personal/group chats, removed a later message and allowed new group messages and an assistant answer. Scheduled volume snapshots are ready; restoring them remains unqualified. |

These are implementation claims, not a claim that every journey is deployed, merged or live
qualified. The [active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) records the
current review work and its evidence.

## Still to complete

- **Useful work across tools:** the internal continuation in [PR #830](https://github.com/elewa-git/opencrane/pull/830)
  can use one permitted tool result in a final assistant answer. CI passes; this change is not yet
  installed. A real integration, company-assistant tool assignment, visible tool progress and
  human-approved changes still need their complete product journeys.
- **Recovery controls:** when a model response cannot be recovered, preserve the pending run and
  show the person what happened and what they can do next. The current server keeps the spent
  request reservation and does not send another paid request. That restraint is implemented in
  source; the user-facing recovery controls remain unfinished.
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
  Existing older runs receive no backfill. Revoked access is checked on every read. Another follow-up
  adds standalone member removal and clears retained workspace content after access loss. Owner
  and self-removal are protected; Fleet removal is unavailable. This work is under review and
  remains unqualified live. See [Remove a company member](/guide/permissions#remove-a-company-member).
- **Login continuity:** preserve authenticated sessions across server replacement and support
  multiple servers consistently. The follow-up implements encrypted PostgreSQL sessions with
  fixed expiry and logout protection. CI and fresh PostgreSQL tests pass; fresh-install live
  qualification remains pending. The current
  testv5 server uses process-local sessions and requires a new sign-in after replacement.

Durable application source, builds and published apps are later work. Temporary computer previews
do not publish an application.

Answer recovery saves the exact prepared answer before posting it, so a restart can recognise its
original content and timestamp. Text checkpoint `378a755b6` in
[#830](https://github.com/elewa-git/opencrane/pull/830) passes
[full CI](https://github.com/elewa-git/opencrane/actions/runs/34300559935), including all seven fresh
PostgreSQL targets and 24 real KurrentDB cases (seven conversation and 17 adapter, excluding skips).
Its corrected PR metadata also passes
[topology CI](https://github.com/elewa-git/opencrane/actions/runs/34301556387).

The continuation implementation at `ada28f1f7` in PR #830 passes
[full CI](https://github.com/elewa-git/opencrane/actions/runs/34303700943). Independent review also
passes. Live qualification remains pending.
Both paths preserve a spent request when its response is unavailable, without paid redispatch. A continuation uses the original key and subtracts the entire first token reservation
before reserving its final request. LiteLLM and provider-internal retries have not been qualified as
exactly-once execution. The answer-recovery, tool-handoff, server model-step and continuation changes
have not been rolled out to testv5. T1 retrieval, T2/T3 approved actions and U1 visible recovery remain
open delivery work.

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
access is removed remain unproven live. The administrative operation and browser clearing are
being completed in the follow-up; they are not installed on testv5.
Computer actions need their complete journeys as their effect admissions become available.

Component tests, a chart render or a healthy process do not establish those complete journeys.
Conversely, a pending live drill does not make already implemented code unfinished. Deployment
evidence belongs in the
[deploy ledger](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md).

> See also: [What is OpenCrane?](/guide/introduction) ·
> [Architecture](/advanced/architecture) · [Installation](/guide/getting-started)
