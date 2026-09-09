# Development status

OpenCrane is **pre-MVP**. The goal is a company workspace where people can ask an assistant for
useful work, review consequential actions and return to the result. Text conversations already
work in the test installation; the next gap is proving a permitted tool retrieval from end to end.

## Implemented, tested and live

These are three different milestones. **Implemented** describes code in the current review stack.
**Tested** describes the checks run against that code. **Live** describes a complete journey in the
dedicated testv5 installation. A passed build neither publishes nor installs a change.

| Capability | Implemented | Tested | Live |
|---|---|---|---|
| Personal-assistant setup and chats | Resumable setup, approved settings, personal answers and saved history | Automated checks and browser journeys | Proven for test employees, including reload |
| Direct and group conversations | Posting, readable member names, creation retries and current audience checks | Automated checks and browser journeys | Group exchange and audience isolation proven |
| Company assistant from a group | Explicit request, linked chat, follow-up and human-reviewed sharing back | Automated checks and browser journeys | Proven with three group members |
| Recent personal activity | Current work status, refresh and links to loaded answers | Automated checks, keyboard and narrow-browser journeys | Proven independently for two employees |
| Server-owned model requests and answer recovery | Private input/key custody, bounded requests and saved-answer recovery after restart | Full CI, including real PostgreSQL and KurrentDB proofs | Replacement not installed |
| One permitted tool and a final answer | One model-selected tool requiring no approval, current permission checks and checked result continuation | Full CI and persistence/retry proofs | Real integration retrieval pending |
| Company tool assignment | Protected API assigns tools to the assistant's own published configuration and permissions | Full CI, including database, API, history and browser checks | Not installed |
| Connection credentials and sharing | MCP catalogue and personal install records exist; credential custody, connection binding, sharing and Waiting for secret recovery are unimplemented | Source audit identifies the missing connection path; install metadata does not prove credentials work | No authenticated connection-sharing or grant-and-resume journey proven |
| Personal tool phases | Queued, running, result received or needs attention, separate from overall work status | Full CI, owner tests and reviewed desktop/narrow Linux states | Not installed |
| Remove organisation access | Protected member removal and clearing private state in the affected browser | Full CI, database and Linux browser checks | Installation and real-account revocation pending |
| Login continuity | Encrypted database sessions, fixed expiry and logout protection | CI and fresh PostgreSQL tests pass | Replacement not installed |
| Computer inspection | Workspace file, diff and browser discovery reads | Boundary and implementation checks | Complete action journeys remain pending; effect routes stay closed |
| Computer workspace recovery | Lease replacement, checkpoint and restore machinery | Implementation checks | Workspace-recovery qualification remains pending |
| Conversation backups | Scheduled file-copy backup/restore and scheduled volume snapshots | Automated checks and recovery drill | File-copy restore and snapshot backup proven; snapshot restore pending |

The source stack and the test installation therefore expose different behaviour. In particular,
testv5 still uses the earlier text-turn implementation and process-local login sessions. Replacing
that server requires signing in again. Existing older personal runs receive no new access backfill.

## Remaining product work

- **Connections and access:** implement personal/company credential custody and usable setup.
  Each connection needs a Shared access list with recipients, access sources, permitted use,
  expiry/status and a revoke action. Before starting dependent work, check credentials and the
  assistant's permission. A missing requirement must show Waiting for secret and let an authorized
  person connect or grant a compatible source, then resume after current checks. Personal Tools
  routes are currently unmounted; the administrator
  catalogue governs existing entries. External registry discovery/import also remains unfinished.
- **Useful tool work:** connect a permitted integration and prove retrieval in personal and company
  conversations. Authenticated integrations need the missing credential path first. Then complete
  approval-dependent actions and the full result-review journey.
- **Recovery and progress:** explain a lost model response and offer safe next steps. The server
  already avoids silently repeating a paid request; user-facing recovery, company-chat progress,
  longer-lived updates, approval, retry and cancellation controls remain unfinished.
- **Memory:** remember, recall, correct and forget useful context across conversations. Current
  personal runs explicitly exclude memory until dataset provisioning and recall are complete.
- **Shared automation:** run company assistants on schedules or triggers, then support delegation
  between assistants. Explicit human requests in a group already have a separate working journey.
- **Files and applications:** finish attachments, generated files and recovery across refresh,
  retry and conversation closure. Durable application source, builds and publication are later
  work; a temporary computer preview does not publish an application.
- **Administration:** complete understandable permission, activity and cost-management surfaces.
  Some administrator operations, including company-assistant setup, currently use the API.

## Qualification record

This is the single summary of current checkpoints; the
[active plan](https://github.com/elewa-git/opencrane/blob/main/plan.md) holds delivery work and the
[deploy ledger](https://github.com/elewa-git/opencrane/blob/main/docs/agents/deploy-ledger.md) holds
installation evidence. These checkpoints do not imply merge, release or rollout.

| Review checkpoint | Verified evidence | Still pending |
|---|---|---|
| Tool continuation, [#830](https://github.com/elewa-git/opencrane/pull/830), `ada28f1f7` | [Full CI](https://github.com/elewa-git/opencrane/actions/runs/34303700943), including all seven fresh PostgreSQL targets and 25 actual KurrentDB cases: eight conversation and 17 adapter | Image publication, installation and external model/tool retrieval proof |
| Member access, [#831](https://github.com/elewa-git/opencrane/pull/831), `e5b8c8c72` | Independent review and [full CI](https://github.com/elewa-git/opencrane/actions/runs/34307836688), including database and Linux browser checks | Installation and real-account revocation proof |
| Company tool assignment, [#832](https://github.com/elewa-git/opencrane/pull/832), `ce3f1a4a9` | Independent review and [full CI](https://github.com/elewa-git/opencrane/actions/runs/34309788971), including five real assignment database cases | Installation and real tool retrieval |
| Personal tool phases, [#833](https://github.com/elewa-git/opencrane/pull/833), `998fe433d` | Independent review and [full CI](https://github.com/elewa-git/opencrane/actions/runs/34310266081), including 118 browser checks and reviewed desktop/narrow Linux states | Installation and live progress proof |

The continuation CI proofs exercise actual storage owners without calling a model or an external
tool provider. Image validation used `push: false`; image publication and the k3d installation job
were skipped. No exactly-once claim is made for LiteLLM or provider-internal retries.

### Proven in the test installation

Five test employees completed sign-in and guided onboarding with approved assistant settings.
Two independently received personal-assistant answers and recovered them after a fresh browser
sign-in and reload. Each can see a newly completed run in Recent activity and open its saved answer.
Refreshing does not start another run. Keyboard navigation focuses the answer and closes the
narrow activity panel; the other employee cannot read that private history or activity.

Three colleagues exchanged ordered group messages. The owner selected a company assistant on a
group message, and all three members opened its linked chat. The assistant answered the request
and a follow-up. The owner then reviewed and edited its answer and shared it back as their own
message. The result survived reload. Creation/posting retries, audience isolation and resuming
live updates also passed.

A scheduled file-copy restore recovered completed personal and group chats, removed a message
written after the backup, and allowed new group messages and an assistant answer. Scheduled volume
snapshots are ready; restoring one remains a separate qualification.

These checks establish the text-conversation and recorded backup journeys on the dedicated test
installation. They do not establish the newer tool continuation, memory or autonomous delegation
journeys. Testv5 has no installed integration for the tool retrieval proof.

> See also: [What is OpenCrane?](/guide/introduction) · [How OpenCrane works](/guide/how-it-works) ·
> [Architecture](/advanced/architecture) · [Installation](/guide/getting-started)
