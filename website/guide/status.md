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
| Personal model turns | Approved persona instructions and conversation history feed a bounded request. The server keeps model input and keys and saves the answer for restart. Absurd advances the turn through model work and at most one permitted tool result and text-only continuation. Live qualification of this replacement remains outstanding. New runs explicitly exclude personal memory while provisioning and recall remain unfinished. |
| Company assistant in groups | Explicit assistant selection on an own group message, recoverable child creation, fixed audience, current parent and child access checks, follow-up answers, and human-reviewed sharing back. Administrator setup uses the API. |
| Personal tool activity | Recent activity shows the latest tool phase separately from the assistant's overall work. A received tool result does not create an answer link; the final message must already be loaded and readable. This phase display is implemented in the follow-up; its live qualification remains pending. |
| Company assistant tool selection | Administrators read and replace exact tools through the API. Changes create immutable revisions and grants for the assistant's own identity; stale edits conflict. Edits preserve the original budget. Connection activation, the management screen and live retrieval proof remain unfinished. |
| Computer inspection | Workspace file, diff and browser discovery routes. Commands, page creation, screenshots and preview actions remain denied until their concrete effect admissions are connected. |
| Computer recovery | Retrying failed starts, renewing or replacing active computers, and saving and restoring workspaces. |
| History operations | Scheduled backups, restore tooling and health checks. A scheduled file-copy restore recovered completed personal/group chats, removed a later message and allowed new group messages and an assistant answer. Scheduled volume snapshots are ready; restoring them remains unqualified. |

These are implementation claims, not a claim that every journey is deployed, merged or live
qualified. The [active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) records the
current review work and its evidence.

## Still to complete

The active delivery order is:

1. **Real tool retrieval:** connect and qualify a dedicated company integration so a permitted
   record informs an answer and its result survives reload and restart. Internal continuation and
   [company tool assignment](/guide/first-agent#choose-its-tools) are implemented; credential
   activation and participant-visible result evidence remain unfinished.
2. **Approved external actions:** let a person review the exact action, target and arguments before
   one approval permits that action once. Changed arguments, expiry or revoked access must stop it.
3. **Long-term memory:** complete remembering, recalling, correcting and forgetting information
   across conversations, with consent and isolated personal and company datasets.
4. **Visible work controls:** show waiting, running and finished work, required decisions and
   supported cancellation. Recent personal activity and its tool-phase display are implemented; complete controls
   and company participant receipts still need their full journey.
5. **Rich interaction:** complete durable choices, free-text questions and structured results that
   remain accessible after refresh.
6. **Documents and generated files:** complete attachment-to-answer and generated-file journeys,
   including access checks and recovery across refresh, retry and conversation closure.
7. **Autonomous delegation:** let an assistant delegate bounded work with explicit context,
   narrower permissions and one recorded result.
8. **Scheduled work:** let people review recurring work that checks current authority each time
   it runs, with clear handling of overlaps, missed runs and retries.
9. **Complete administration:** finish agent, connection, model, permission and spending controls.
   Standalone member removal and browser clearing after access loss are implemented in review;
   the real-account journey remains unqualified. See [Remove a company member](/guide/permissions#remove-a-company-member).
10. **Action recovery:** explain uncertain outcomes and provide supported reconciliation and safe
    retry controls. The server already preserves a spent model request without dispatching it again;
    the full recovery experience remains unfinished.

Login continuity also needs fresh-install live qualification. Encrypted PostgreSQL sessions with
fixed expiry and logout protection are implemented and pass CI and fresh PostgreSQL tests.

Durable application source, builds and published apps are later work. Temporary computer previews
do not publish an application.

Answer recovery saves the exact prepared answer before posting it, so a restart can recognise its
original content and timestamp. The Absurd implementation in
[#849](https://github.com/elewa-git/opencrane/pull/849) passes CI and independent review; its live
testv5 qualification remains separate. The conversation Pod no longer schedules model work.
An unavailable response stays recorded without paid redispatch, and a continuation uses the original
key and remaining call and token allowance. Provider-internal retries have not been qualified as
exactly-once execution. Company tool assignment enables the next retrieval step; it does not prove
that a live integration is connected or that the complete tool journey is ready.

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
