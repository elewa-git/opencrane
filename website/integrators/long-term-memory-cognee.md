# Long-term memory, Cognee and dreaming

OpenCrane's **long-term-memory design** is for durable facts that may remain useful after a
conversation ends. Cognee is the intended content and retrieval store; OpenCrane decides whose
memory it is, who may use it, why it was retained and how it may be corrected or forgotten.

> See also: [Memory write, manage and read](/integrators/retrieval-memory) (the runtime loop),
> [Silo IAM](/integrators/silo-iam) (membership and grant evaluation),
> [Organisation boundary](/operators/organisation-boundary) (silo isolation), and
> [Connect organisational knowledge](/guide/knowledge) (current administrator-facing status).

Status markers on this page mean ✅ live, 🔶 partially implemented or scaffold-only, and ◇ target
design.

## Memory is scoped, not global

There is no one database called “the agent's memory”. A `MemoryDataset` belongs to one silo and one
authorisation scope. Its Cognee dataset UUID is an internal coordinate selected by OpenCrane, not a
capability a caller may present.

| Scope | Intended content | Who may select it today |
|---|---|---|
| Personal ✅ / 🔶 | Facts and preferences belonging to one authenticated person | Personal-run admission derives the one active dataset from the verified silo, organisation and subject. There is no production dataset provisioner, and recall content is still blocked before Cognee. |
| Project, team or department 🔶 | Knowledge shared inside one bounded organisational group | The scope vocabulary and gateway contracts exist, but managed runs currently freeze memory scope `none`. |
| Organisation 🔶 | Knowledge deliberately shared across the whole organisation | The dataset schema supports organisation scope. No production admission or recall path selects it yet. |

Personal memory and organisation memory are therefore **separate datasets with separate authority**.
Organisation memory is not the union of every employee's personal memory.

::: warning
A dataset name, UUID, Kubernetes namespace or network location never grants memory access. Authority
comes from verified identity, current membership, grants, scope, action and consent.
:::

## What OpenCrane and Cognee each own

Role-based access control (RBAC) stays in OpenCrane; Cognee never evaluates it.

```text
 authenticated person or service
              │
              ▼
 ┌──────────────────────────────────────────┐
 │ OpenCrane                                │
 │ identity · RBAC · consent · sensitivity │
 │ dataset selection · provenance · digest │
 │ correction/forget state · audit evidence│
 └────────────────────┬─────────────────────┘
                      │ exact frozen Cognee dataset UUID
                      ▼
 ┌──────────────────────────────────────────┐
 │ private memory gateway                   │
 │ server TokenReview · bounded search only │
 │ canonical request · defensive response   │
 └────────────────────┬─────────────────────┘
                      │ private HTTP
                      ▼
 ┌──────────────────────────────────────────┐
 │ Cognee                                   │
 │ fact content · indexes · graph/vector    │
 │ state                                    │
 └──────────────────────────────────────────┘
```

| Owner | Durable responsibility | Must not decide |
|---|---|---|
| OpenCrane PostgreSQL | Dataset scope, Cognee identifiers, content digests, consent, sensitivity, provenance, correction/forget state and outbox intent | Semantic relevance or fact text |
| Memory gateway | Authenticate the deployment-fixed server ServiceAccount identity and constrain one Cognee exchange | Human membership, grants or dataset choice |
| Cognee | Store and search indexed fact content and its graph/vector representation | OpenCrane RBAC or cross-scope sharing |
| Runtime Job | Propose a query or memory candidate for its current attempt | Dataset selection, durable retention or direct Cognee access |

OpenCrane deliberately does not duplicate fact text in its catalogue. A catalogue row can explain
which external fact was accepted and why without becoming a shadow memory store.

## RBAC before retrieval

Memory access has two independent questions:

1. **May this principal perform this action in this scope?** Membership and grants answer that.
2. **Which exact dataset represents that scope?** The memory authority answers that from trusted
   coordinates.

The dataset lookup happens after identity has been established. A query or tool argument cannot
widen it.

### Personal recall today

```text
 OIDC session
      │
      ▼
 signed personal membership assertion
      │ exact silo · organisation · subject
      ▼
 active, time-valid personal grants
      │ hashed into the run capability evidence
      ▼
 personal AgentService + active personal MemoryDataset
      │ dataset id + Cognee dataset UUID
      ▼
 immutable RunInputSnapshot
      │ model proposes memory_recall
      ▼
 exact participant permission + one-use receipt
      │
      ▼
 `safe_delivery_required` — current stop, before Cognee
```

✅ The membership, personal grant, dataset-selection, frozen-snapshot and permission boundaries are
live. 🔶 The final read is not: production execution stops before the memory gateway because recalled
content does not yet have an ephemeral, attempt-fenced return path.

The permission receipt is one-use and binds the run, attempt, invocation revision, query digest,
snapshot digest, persona revision and expiry. A later or altered request cannot reuse it.

The current path includes active personal grants in the run's capability evidence, but it does not
evaluate a memory-specific grant before selecting the personal dataset. Identity-bound selection
and exact interactive permission are real controls; they are not yet the complete read-capability
decision the target design requires.

### Organisation recall target

Organisation recall must reuse the IAM intersection rather than invent a second memory ACL:

```text
 current organisation membership
              │
              ▼
 acting principal grants ∩ AgentService grants
              │
              ▼
 exact read capability + organisation scope + dataset resource
              │
              ▼
 active organisation MemoryDataset
              │ frozen into admitted run/dream manifest
              ▼
 bounded gateway search → transient result for that exact workload
```

◇ The general grant model and a dual-principal effective-access algorithm exist, but the algorithm
has no production caller for organisation memory. Managed runs explicitly freeze scope `none` so
they cannot fall back to a delegated user's personal dataset.

Agent revisions can declare exact organisation, department, team or project scope attachments, but
an attachment requests scope—it does not grant it. The current production scope-grant resolver
returns no grants, so every non-empty shared attachment set fails closed before it can become
managed-memory authority.

An organisation-wide agent may be broadly useful without being universally authorised. Both the
person asking and the AgentService performing the work must remain inside the accepted capability
and scope. A deny, revocation, expired membership or empty grant intersection wins.

## Network isolation is not RBAC

The private deployment uses several layers because each one answers a different question.

| Layer | Question it answers |
|---|---|
| OpenCrane IAM | Is this person or service allowed to read, derive, publish, correct or forget memory in this scope? |
| Run or dream admission | Which immutable identity, capabilities, datasets, policy and budget were accepted for this workload? |
| Projected ServiceAccount token | Is the caller the expected OpenCrane server workload? |
| Kubernetes RBAC | May the gateway ask the Kubernetes API to perform `TokenReview`? It grants no memory content access. |
| Memory-gateway validation | Is this one bounded search request well formed and tied to exactly one dataset UUID? |
| NetworkPolicy | Can this pod establish a connection to that pod and port at all? |
| Cognee | Can the accepted content be indexed or searched? |

Cognee's own login middleware is disabled in the bundled private deployment. This is safe only
because the authenticated memory gateway is the sole network caller admitted to Cognee. NetworkPolicy
is a transport wall; OpenCrane remains the product RBAC authority.

## What “dreaming” means

**Dreaming** is a proposed offline consolidation process over long-term memory. It turns many small,
already-authorised facts into **candidate** summaries, patterns, corrections or links. It is not a
long-running agent thinking without supervision, and it is not permission to retain everything a
model has seen.

::: info Current status
OpenCrane does not implement dreaming today. Cognee indexing is not dreaming, and no scheduled
worker currently reads a memory corpus and publishes derived facts.
:::

A dream should improve memory quality by:

- consolidating duplicates without losing their sources;
- detecting contradictions and proposing a correction;
- identifying stable preferences or recurring organisational knowledge;
- linking related facts so retrieval needs fewer, better results; and
- marking stale or low-value candidates for review instead of silently deleting them.

The output is never immediately trusted fact content. It first enters the **Manage** stage as a
candidate with complete derivation evidence.

## Personal dreaming

A personal dream is confined to one person's dataset and their policy. It may connect patterns
across that person's authorised facts, but it cannot inspect another person's personal dataset or
publish into organisation memory.

```text
 one personal dataset + owner policy
                │ frozen dataset and source-fact digests
                ▼
 ┌──────────────────────────────────────┐
 │ bounded personal dream Job ◇         │
 │ deduplicate · relate · detect conflict │
 └──────────────────┬───────────────────┘
                    │ derived candidates only
                    ▼
 ┌──────────────────────────────────────┐
 │ Manage                               │
 │ provenance · consent · sensitivity  │
 │ conflict · retention · owner review │
 └──────────────┬───────────────┬───────┘
                │ accepted      │ rejected/expired
                ▼               ▼
        same personal dataset   discard candidate
```

The owner remains the authority. Initially, every candidate requires exact owner approval. A
personal dream must not infer and retain protected or highly sensitive attributes merely because
the model can guess them. A rejected or expired candidate never reaches Cognee.

## Organisation dreaming

An organisation dream operates over an organisation-scoped corpus: approved policies, decisions,
artifacts and facts already shared with the organisation. It does **not** scan every personal
dataset.

```text
 personal datasets                     organisation-scoped inputs
 ┌───────┐ ┌───────┐ ┌───────┐         policies · artifacts · shared facts
 │ user A│ │ user B│ │ user C│                         │
 └───┬───┘ └───┬───┘ └───┬───┘                         ▼
     │         │         │              ┌──────────────────────────┐
     └─────────┴─────────┘              │ organisation MemoryDataset│
          privacy wall                  └─────────────┬────────────┘
     no implicit aggregation                          │ frozen corpus
                                                     ▼
                                         ┌──────────────────────────┐
 explicit owner-approved promotion ────► │ organisation dream Job ◇ │
 into organisation scope only            └─────────────┬────────────┘
                                                     │ derived candidates
                                                     ▼
                                         owner/policy review → publish
```

The safe default is a one-way privacy wall: personal facts remain personal. Moving a fact from a
personal dataset into organisation memory is a separate, explicit promotion decision with its own
purpose, sensitivity classification and provenance. It is not a search fallback or a side effect of
dreaming.

When a future dream combines several non-personal scopes, the output audience must be no broader
than the intersection of every input audience. An empty intersection discards the candidate.
Promotion into a broader destination needs a separate source-owner and destination-steward decision;
the broadest input must never become the default output scope.

An ordinary cross-scope candidate keeps every source audience and grant revision as a read-time
dependency. Later membership loss, revocation or scope narrowing immediately removes it from the
effective audience. The only way to detach those dependencies is an explicit independent promotion:
every source authority and the destination steward approve a newly scoped fact and its reviewed
content.

If a future product needs patterns across personal memories, that is a separate privacy-preserving
aggregation capability—not ordinary organisation dreaming. It would need explicit participation,
minimum cohort sizes, suppression of identifying details, purpose limitation and proof that the
result cannot reconstruct a contributor's personal facts.

## The governed dream lifecycle

```text
 schedule / event / operator request
                  │
                  ▼
 admission: identity + scope + grants + policy + budget
                  │ immutable dream manifest
                  ▼
 bounded reads through memory gateway
                  │ source ids + digests
                  ▼
 model synthesis in an ephemeral Job
                  │ candidate, never direct write
                  ▼
 Manage: validate + classify + review + deduplicate
                  │ accepted derived fact
                  ▼
 Cognee durable acceptance
                  │ external id + content digest
                  ▼
 OpenCrane catalogue + outbox commit
```

The dream Job should be as disposable as an agent-runtime Job. It receives an immutable manifest,
bounded source material, a model route, token/cost limits and a deadline. It receives no database
credential and cannot call Cognee directly. Completion, failure and cancellation remain
server-owned outcomes.

## Derived facts need stronger lineage

The current catalogue accepts exactly one immediate source: an artifact revision, conversation
message or explicit user statement. That is sufficient for a directly recorded fact, but not for a
dream that derives one candidate from many facts.

◇ Before dreaming can ship, the durable model needs:

- a dream-run manifest with the frozen dataset, source set, policy revision, model route and prompt
  digest;
- a candidate lifecycle separate from accepted facts;
- many-to-many source edges with the source fact id and content digest;
- source audience, membership and grant revisions that are re-evaluated on every future read;
- an explicit derived-fact provenance kind;
- reviewer or policy-decision evidence for promotion;
- idempotent publication across Cognee and the OpenCrane catalogue; and
- dependency invalidation when any source is corrected, forgotten, loses consent or its audience
  authority narrows.

A derived fact cannot outlive the evidence that made it valid. Forgetting a source should mark its
dependants stale or forget-pending, then re-evaluate or remove them without erasing the historical
decision evidence.

The delivery path must also join every Cognee result back to active OpenCrane catalogue metadata by
dataset and external fact id. Only `Active` facts may reach a workload. Correction or forgetting
must revoke catalogue read eligibility before asynchronous Cognee mutation begins, so a stale
indexed result is dropped even while remote deletion is pending.

## Roles in the target design

| Principal | Permitted role | Prohibited shortcut |
|---|---|---|
| Memory owner | Consent, review, correct, forget and explicitly promote their own memory | Granting access by sharing a dataset UUID |
| Organisation knowledge owner | Approve sources, retention and organisation-derived candidates | Reading personal datasets by virtue of being an administrator |
| AgentService | Query only within the capabilities and scope accepted for its run | Expanding the actor's rights or selecting a broader dataset |
| Dream service ◇ | Read one frozen corpus and emit candidates under a dedicated policy and budget | Publishing directly or crossing scopes |
| OpenCrane server | Evaluate authority, freeze manifests, manage candidates and commit evidence | Treating network reachability as authorisation |
| Memory gateway | Authenticate the server and constrain Cognee transport | Evaluating human RBAC or choosing datasets |
| Cognee | Index and retrieve accepted content | Deciding consent, sharing, correction or forgetting policy |

## Maturity

| Capability | Status |
|---|---|
| Private, persistent Cognee deployment | ✅ PVC-capable and digest-aware chart; the supported real-silo deploy workflow requires an exact image digest. This is not proof of end-to-end recall qualification. |
| TokenReview and NetworkPolicy-protected search gateway | ✅ Implemented and charted; the server client factory has no production caller |
| Identity-bound personal dataset selection at run admission | ✅ Live selection; no production dataset provisioner |
| Personal recall content returned to the active attempt | 🔶 Blocked at `safe_delivery_required` |
| Organisation, department, team or project recall | 🔶 Schema and port groundwork; managed scope is `none` |
| Fact record, correction, forgetting and scoped injection | 🔶 Contracts/catalogue groundwork; production writes fail closed |
| Personal or organisation dreaming | ◇ Target design; no worker, candidate authority or derived lineage yet |

::: warning Current cut-line
The repository provides a private search boundary, identity-bound personal dataset selection, an
exact recall-permission receipt, metadata schemas and fail-closed future ports. It does not yet
provide usable personal recall, organisation recall, memory ingestion, correction, forgetting,
derived-fact lineage or dreaming.
:::

## Sources

- [`Memory dataset and fact catalogue schema`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/memory.prisma)
- [`Authorisation grant schema`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/authorization.prisma)
- [`Personal memory admission`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/personal/memory/main/src/prisma-personal-memory-admission-repository.ts)
- [`Managed no-memory policy`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/inputs/main/src/managed-no-personal-memory-scope-source.ts)
- [`Shared scope-grant resolver`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/agents/agent-services/main/src/prisma-scope-grant-resolver.ts)
- [`Uncomposed server client factory`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/src/infra/memory/memory-gateway-client.factory.ts)
- [`Memory gateway app`](https://github.com/elewa-git/opencrane/blob/main/apps/memory-gateway/README.md)
- [`Cognee deployment`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/cognee/README.md)
