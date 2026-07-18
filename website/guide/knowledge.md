# Connect organizational knowledge

::: tip What's organizational knowledge?
Your company's own information — from Slack, email, documents, tickets — gathered
into a searchable index. With it, an assistant answers from **real company facts,
with citations**, instead of guessing.
:::

## How it works

- OpenCrane runs **collectors** that continuously pull in knowledge from your systems
  and organize it by [scope](/guide/organize) (personal, project, department, org).
- During a conversation, an assistant **looks things up directly** and answers with
  citations. OpenCrane never reads the conversation — it only decides which knowledge
  an assistant is allowed to see.
- What an assistant can reach is set by [access](/guide/permissions): a department's
  documents only reach that department.

## Keep every assistant consistent

So every assistant behaves the same way when it looks things up — same rules for
which sources to use, when to cite, and how fresh information must be — OpenCrane
applies a shared set of rules across the fleet. You roll changes out gradually (to a
few assistants first, then everyone) and can undo in one step. Inspect or change the
rollout through the authenticated `/api/v1/awareness/rollout` endpoints; see
[Awareness SLOs](/operators/awareness-slos) for the operational sequence.

## Keep access boundaries consistent

Knowledge access follows the assistant owner's authenticated identity, group
membership, and dataset grants. Starting a new conversation never widens those
rights; change them through the same [access controls](/guide/permissions) used for
skills and tools.

## Going deeper

How collection, datasets, and freshness work under the hood is in the
[Retrieval & memory deep dive](/integrators/retrieval-memory). Health dashboards are
in [Awareness SLOs](/operators/awareness-slos).
