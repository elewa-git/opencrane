# Agent skills

A **skill** is a reusable ability you give to assistants — drafting a sales follow-up, reviewing
a pull request, summarising a support ticket. In OpenCrane a skill is a **versioned, reviewed,
signed artifact**, not an executable snippet appended to someone's workspace: it can be shared
across a team or the whole organisation without trusting mutable runtime-local files.

::: info Foundation in progress
The ArtifactStore-backed publication authority is implemented, but the end-user catalogue,
authoring, and sharing API and UI are not mounted yet. The retired bundle-registry endpoints are
not a supported path.
:::

## What a skill contains

A skill bundle carries everything needed to review and trust it:

- `SKILL.md` — the instructions the agent follows, and when to use them;
- optional Python code and its tests;
- declared requirements: which MCP tools, models, and network access it needs;
- provenance — who authored it, from what.

Published, a skill is an immutable **SkillRevision** whose content digest is what runtime
contracts reference. There is no "latest" that can drift underneath a running agent: an agent
revision pins the skill revisions it was reviewed with.

## The publication lifecycle

Skills move from draft to shared ability through a governed pipeline:

1. **Author (🔶 planned product surface).** The target workflow gives a personal assistant a
   governed **skill-builder** tool: ask it to turn a working conversation — a procedure you refined
   together, a prompt that finally worked — into a candidate skill bundle, or draft one from
   scratch. Invoking that tool will start this pipeline; it will never shortcut it. Drafting can be
   cheap and conversational, but the draft holds no authority until it has passed the steps below.
2. **Isolated authoring job.** A dedicated Job with only a draft-workspace capability — no
   production MCP credentials, default-deny egress — runs formatting, types and tests,
   dependency and licence checks, secret and malware scans, and policy validation.
3. **Review.** A human or an authorised publishing workflow reviews the diff and the test and
   scan evidence.
4. **Sign and publish.** OpenCrane signs and publishes the immutable SkillRevision and advances
   the skill's current pointer atomically. The publication service accepts only an exact
   `SkillRevision`/`ArtifactRevision` pair with successful evidence, a signature, and a revision
   already in review.

The implementation of the publication authority lives in
[`libs/backend/server/agents/skills/main`](https://github.com/elewa-git/opencrane/blob/own-personal-ai-agent-setup/libs/backend/server/agents/skills/main).
The public product workflow builds on that authority rather than restoring an OCI bundle
registry or compatibility route.

Sharing follows the platform's scope model — personal, project, department, organisation — and
promotion across scopes is an explicit review boundary: a skill drafted from a personal
conversation never silently becomes a company asset, and publishing it never grants it
retroactive access to the conversation that produced it. See
[Control access](/guide/permissions).

## How skills execute

A skill is a context ingredient, not an agent. Loading one changes what an agent *knows how to
do*; it does not by itself create any new identity or authority. Which execution tier a skill
uses is decided by what the skill demands:

### Tier 0 — inline load

The default. The agent pulls the SkillRevision's instructions into its **current** context and
follows them right there — same run, same capabilities, same budget. Right for procedures the
agent should apply in place: a formatting standard, a runbook, a checklist. The only cost is
context space, which motivates the next tier.

### Tier 1 — in-process specialist (agent-as-tool)

The agent runs the skill in a **fresh sub-context inside the same run** and gets back only the
result — useful when a skill's instructions and intermediate work are heavy and would pollute the
main conversation. Same identity, same capabilities, same budget, part of the same audit record;
if the specialist proposes a governed action, it surfaces through the *parent's* approval path.
This tier is a convenience for context hygiene — it is **not** a security boundary.

### Tier 2 — governed child run or tool job

When a skill demands more than instructions, execution crosses a real boundary:

- A skill that needs **capabilities the agent shouldn't hold open**, **its own budget**, or a
  **lifetime beyond the conversation** runs as a [child run](/guide/child-runs) — its own
  identity, its own (smaller) capability set, its own audit trail.
- **Tenant-authored Python never executes inside the conversational pod.** Trusted image-baked
  tools may run in-process, but user-authored code executes through an isolated tool Job with
  exactly the capability its declared requirements were reviewed against.

**Rule of thumb:** pure instructions → tier 0 or 1; capabilities, spend, or code execution →
tier 2. The tier is a property of what the skill was reviewed to need — an agent cannot quietly
upgrade a checklist into a code-executing specialist.

## What comes next

The product surface still needs catalogue browsing, isolated authoring jobs mounted end-to-end,
review and publication workflows, and governed sharing across personal, project, department and
organisation scopes. Until those surfaces are mounted, there is no supported end-user
skill-publishing workflow.

> See also: [Agent delegation (child runs)](/guide/child-runs) ·
> [Control access](/guide/permissions) · [Architecture](/advanced/architecture)
