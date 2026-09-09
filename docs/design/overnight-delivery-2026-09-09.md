# Overnight delivery: 9 September 2026

OpenCrane is a workspace where employees set up personal assistants, talk with colleagues and ask
a company assistant to help in a linked group chat. The vision extends that working text experience
to useful company work with controlled tools, knowledge and spending. The overnight run advanced
that path without adding another execution, history or authorization system.

This is a dated handoff, not a release announcement. The active backlog remains in
[plan.md](../../plan.md), with full acceptance criteria in [the delivery plan](mvp-delivery-plan.md).
The overnight boundary is 08:00 EAT / 05:00 UTC. No merge, release tag or fresh-baseline installation
is implied by an implementation or a green PR.

## Against the original four requests

- **Baseline and recovery:** [#772](https://github.com/elewa-git/opencrane/pull/772) now targets
  `develop` with valid ancestry. The requested file-copy restore, anonymous health check and
  volume-snapshot backup are proven. [#827](https://github.com/elewa-git/opencrane/issues/827)
  now has bounded KurrentDB channel reads and live cursor-resume proof.
- **Faster development:** specialist dispatch follows the changed responsibility, boundaries fail
  before expensive CI work, and ineffective cross-run Nx cache transfers are removed. The measured
  follow-up opportunities below preserve the database and access checks that found real defects.
- **Clear product and architecture documentation:** the README and website explain personal and
  shared assistants from the company-work vision. The architecture follows one request through its
  existing owners; exact runtime/recovery detail has one deeper guide. The status page separates
  implementation, automated tests and live journeys.
- **Onboarding and conversations:** employee setup, personalised answers, group exchange, explicitly
  requested company-child chats, follow-up and human-reviewed sharing are live-proven. Autonomous
  subagent delegation remains its own unfinished product track.

## Review surfaces and evidence

| Review surface | Delivered behavior | Qualification |
| --- | --- | --- |
| [#826](https://github.com/elewa-git/opencrane/pull/826) | Conversation/computer baseline, personal onboarding, group text and explicitly requested company-child conversations; replay CI repair. | Existing CI and dedicated testv5 text/recovery evidence retained. Baseline remains under review. |
| [#829](https://github.com/elewa-git/opencrane/pull/829) | Encrypted persistent login sessions and personal activity with saved-answer navigation. | Session code and fresh PostgreSQL tests pass. Activity is live-proven; session replacement needs a matching fresh installation. |
| [#830](https://github.com/elewa-git/opencrane/pull/830) | One permitted tool can complete between the initial model request and a saved final answer, within the original allowance. | `ada28f1f7` passes [full CI](https://github.com/elewa-git/opencrane/actions/runs/34303700943): seven PostgreSQL targets, 25 actual Kurrent cases and image validation. No real integration is installed for live retrieval proof. |
| [#831](https://github.com/elewa-git/opencrane/pull/831) | Administrators remove member access; the browser clears private state and rejects late responses after denial. | `e5b8c8c72` passes [full CI](https://github.com/elewa-git/opencrane/actions/runs/34307836688): eight PostgreSQL targets, Kurrent, 123 browser checks, Linux visuals and six image validations. Real-account installation proof remains pending. |
| [#832](https://github.com/elewa-git/opencrane/pull/832) | Protected company-tool assignment, own-principal grants, immutable revisions and fresh two-request provisioning within unchanged total limits. | `ce3f1a4a9` passes [full CI](https://github.com/elewa-git/opencrane/actions/runs/34309788971): all eight PostgreSQL targets, including five new assignment cases, API/history/browser checks and six image validations. Installation and real retrieval remain pending. |
| [#833](https://github.com/elewa-git/opencrane/pull/833) | Personal Recent activity shows the latest tool phase without exposing inputs/results or claiming the answer is complete. | `998fe433d` passes [full CI](https://github.com/elewa-git/opencrane/actions/runs/34310266081): database/history/API checks, 118 browser cases, reviewed desktop/narrow Linux visuals and six image validations. All 512 focused unit tests and independent review also pass. Live progress remains pending. |

Review order is #826 → #829 → #830 → #832 → #833. Member removal #831 is a separate child of
#829; its implementation is not silently included in the tool branch. The documentation handoff
follows #833. Each review surface retains its own base and source evidence. Current named stack
integrity checks pass. Earlier failed/cancelled topology workflow jobs remain visible after parent
repairs; they do not describe the current ancestry. The independent Nx-skills PR #772 also retains
an earlier [k3d failure](https://github.com/elewa-git/opencrane/actions/runs/34093680402/job/101652863990);
its rebase is complete, but this overnight does not qualify that separate smoke test.

## What is proven in the test installation

The serving UI is `6692b2e59`, with server `e50cdcc5b` and the earlier database baseline. Five test
employees completed sign-in and guided onboarding. Two received independent personalised answers,
recovered them after fresh sign-in and reload, and used personal activity with keyboard and narrow
screen navigation. Cross-employee private reads were denied. Three colleagues exchanged group
messages, used the company assistant in a linked chat, followed up and shared an edited answer
back as a human message.

A scheduled file-copy restore recovered eight audience histories and allowed a subsequent group
message and assistant answer. The restore command took 99.835 seconds; command start to verified
history took 200.991 seconds. Anonymous Kurrent health and scheduled volume-snapshot backup passed.
Restoring a snapshot remains unqualified. Exact image, storage, account and operation evidence
belongs in the [deploy ledger](../agents/deploy-ledger.md).

The new session baseline, tool continuation, removal operation, company-tool configuration and
phase display have not been installed together on testv5. Image validation in a PR does not publish
or deploy the images. No additional live proof was inferred from those checks.

## Next product work

1. **Qualify one real retrieval.** Select a dedicated, explicitly authorized integration and fixture.
   None is suitable in the current test installation. Prepare the matching fresh-install candidate
   through the existing release/deploy owners, then prove both personal and company-child retrieval,
   the saved final answer, phase refresh and current-access denial. Preserve the existing volumes;
   replacing them or adding new shared infrastructure needs its own concrete approval.
2. **Let a personal owner approve one precise action.** Reuse the existing approval, elicitation,
   invocation and executor records. The model may offer only a fully reviewable frozen tool; the
   server must atomically open a waiting approval without creating an executor. Display the exact
   safe reviewed arguments. Approval resumes that same invocation after fresh authority checks;
   denial, expiry or revocation performs no external action. Test restart and response uncertainty
   at every boundary. Keep the original time/token/credential allowance; approving cannot renew it.
3. **Extend review and recovery deliberately.** Company approval needs a separate human-reviewer
   contract: the approval's execution principal remains the managed assistant, while the assigned
   reviewer and exact decision grant identify the human. A group viewer is not automatically an
   approver. Cancellation, ambiguous external outcomes and user-driven retries are the separate T3
   track. Personal phase display alone supplies none of those controls.
4. **Prove memory isolation before enabling writes.** Keep reads/writes behind the memory gateway.
   The pinned Cognee contract distinguishes chunk IDs from document handles, lacks the assumed
   HTTP delivery-key behavior, and requires an actual two-dataset retrieval/forget proof. Repair
   source identity and dataset validation first, then implement one durable remember operation,
   correction and verified deletion through the existing personal-memory owner. Current personal
   runs explicitly exclude unfinished memory; this is not a claim of an observed live leak.
5. **Make one uploaded document useful.** Reuse upload, quarantine, scanning and download owners.
   Current compiler artifact summaries contain media type and revision identity, not document text.
   Admit one clean, currently authorized document into the immutable input, preserve provenance and
   test an answer from its content. Generated-file custody/finalization follows as a separate step.
6. **Continue the remaining planned tracks.** Bound autonomous child delegation after action and
   cancellation contracts; then qualify scheduling, operator controls, usage and recovery. An
   explicitly requested company child chat does not establish autonomous delegation. The old #320
   reservation/completion implementation is absent from the current baseline; D1 needs explicit
   parent/child authority and result contracts in the existing run owner. The surviving scheduler
   helper is not a product scheduler, so S1 still needs recurrence and current-authority admission.

The approval bridge is anchored in
[deferred tool approval](../../libs/backend/server/iam/authorization/main/src/deferred-tool-approval.ts)
and the [conversation model flow](../../libs/backend/server/conversations/main/src/conversation-computer-model-flow.ts).
The memory identity gap is in
[Cognee payload decoding](../../libs/backend/server/infra/memory-gateway-client/src/cognee-payloads.ts),
and the document-input gap is in
[prompt compiler reads](../../libs/backend/agents/execution/inputs/main/src/prisma-prompt-compiler-repository.ts).
These are existing owners to extend, not reasons to introduce parallel services.

## Delivery process observations

One implementer and one integrated reviewer remained the default; backend and frontend work ran
in parallel when their owners were independent. Focused checks were reused for unchanged source.
Actions supplied real PostgreSQL and Linux image/browser evidence; no local database or container
runtime was started.

Real SQL caught a consequential defect in the shared revision writer: nested tool creation included
an agent-service field inherited from its parent relation. The repair uses the exact generated
Prisma nested-input type. A later full affected run caught a stale personal-configuration assertion
of that same field. API snapshot and Linux visual-baseline failures were generated-artifact gaps;
only the changed snapshots were reviewed and committed. No screenshot tolerance or authority check
was relaxed to make the checks pass.

The successful member-removal run took **8 minutes 58 seconds**. Preparation took 51 seconds,
affected build/test/lint took 5 minutes 48 seconds, and the last image validation added up to
2 minutes 8 seconds. SQL and browser jobs ran alongside that critical path. Across four measured
runs, preparation queued for 3–20 seconds; the evidence points to repeated validation cycles as the
main delay, rather than general runner starvation. These timings come from the
[member-removal run](https://github.com/elewa-git/opencrane/actions/runs/34307836688) and the
[company-tool repair run](https://github.com/elewa-git/opencrane/actions/runs/34308712702).

The next process improvements are concrete:

- Include the concrete personal and company callers when a shared persistence contract changes.
  Update both the generated API client and published OpenAPI snapshot together. Inventory changed
  visual stories before CI, then collect their reviewed Linux baselines in one repair.
- Reuse unchanged owner tests and exact review evidence; check live ancestry after parent repairs.
  The existing scope-based specialist policy is sufficient for this work.
- Measure PR-only image validation in parallel with the other checks, while retaining the final
  all-green qualification and publication gate. Its potential benefit is the observed image tail;
  the tradeoff is runner work spent on candidates that later fail.
- Measure trusted Nx task-output reuse. Dependency and browser caches already work; no new cache
  service or guard removal is justified by this audit alone.

The latter workflow/cache experiments remain proposals, not implemented speedups. Fresh SQL caught
real defects quickly and remains part of acceptance. Credentials, unrelated local agent files and
user screenshots remain outside these commits. The overnight schedule ends at the stated boundary;
remaining implementation and live qualification retain their explicit next actions above.
