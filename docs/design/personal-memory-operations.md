# Personal memory operations

This is the implementation contract for explicit Remember, separately consented recall in another
conversation, Correct and Forget. Work is in progress. The current status and validation evidence
belong in [plan.md](../../plan.md); this document describes the intended behavior and ownership.

## Content and authority

| Owner | Responsibility |
| --- | --- |
| Conversation history and private payload store | Preserve the encrypted human message and its exact author, position and payload coordinates. |
| Personal-memory domain | Admit commands under current authority; own dataset, fact catalog and operation state. |
| Absurd | Admit the task with the command, save checkpoints and resume the same operation after interruption. |
| OpenCrane server | Read an authorized source transiently, call the gateway and prepare a permitted recall result. |
| Memory gateway | Validate the server identity, translate the private protocol and hold the provider credential. |
| Cognee | Store document content, build the index and preserve correlated pipeline-run evidence. |

OpenCrane's memory tables contain coordinates, consent, provenance, revisions, fixed failure codes
and digests. They contain no remembered text, search chunks, provider responses or credentials.
Workflow arguments contain identifiers and revisions. A task reads authorized content when it needs
it; plaintext never crosses the operation's SQL transaction.

There is one personal dataset per verified Principal and silo. Its immutable catalog ID is generated
by the server before provisioning. The provider name is `opencrane-memory-${sha256(dataset.id)}`, derived
from that saved ID; it is neither request input nor a second stored name. A Provisioning dataset
has no provider UUID and cannot be used for recall. The UUID is adopted only after the gateway proves
the dataset's permissions are complete. A model argument or caller-supplied subject cannot choose
the dataset used for recall; the admitted conversation run freezes that coordinate. UUID adoption
and the operation's DatasetEnsured transition activate the dataset in one transaction. New dataset
creation explicitly chooses Provisioning; the existing Active default requires a provider UUID.

## Command admission

Remember initially accepts one completed human message written by the authenticated caller.
It does not accept an arbitrary text field or another participant's message. Correct identifies a
new authorized source message and an expected revision of the old fact. Forget identifies the exact
fact and expected revision. These authenticated commands are explicit consent for their operation.

Facts created by this direct message flow record Explicit consent and the server-selected
`personal` sensitivity. The command cannot choose or change that classification. It describes the
fact's personal context and grants no access; dataset, consent and lifecycle checks remain required.
Supporting more classifications later requires admitting and retaining the selected value before
provider dispatch so a restart cannot change it at catalog completion.

The source reader binds silo, conversation, message ID, message position, author, private payload
reference and ciphertext digest. It must still work after later messages are appended. A whole
conversation-head equality check would incorrectly invalidate a saved Remember command.

Admission reads and hashes the source outside SQL. One Serializable transaction then revalidates
the source coordinates, current authority and command replay key, saves the operation and admits its
Absurd task. The worker rereads the same source and requires the saved content digest before sending
any document to the gateway. A changed source cannot replace the admitted command.

Creating the first dataset requires the personal Principal's collection Create authority. Subsequent
Remember and Correct commands require Manage on the exact memory scope; Forget requires Forget.
Recall retains Dataset Use and MemoryScope Use as well as its invocation-specific permission.

## One durable operation owner

The fact catalog is the index used for authorization, rather than a record of partially dispatched
effects. A separate personal-memory operation owns the admitted command, its immutable source,
provider receipts, workflow identity, revision and recovery state. The common lock order is dataset,
referenced facts sorted by ID, then operation.

Command kind and lifecycle have separate responsibilities: kind selects Remember, Correct or Forget
behavior; the lifecycle decides whether the saved evidence permits the next step. Repositories and
controllers must not maintain their own competing transition tables.

Remember and Correct use the operation UUID as the new fact ID. Their content-free Message
provenance comes from the saved operation and selected message; it does not classify the fact as
an ExplicitUserFact for automatic preference selection. Catalog publication and the accepted
operation transition share one transaction. Correct inserts the successor and lets PostgreSQL mark
the prior fact Corrected and increment its revision. Forget finalization updates the saved target
from ForgetPending at admitted revision R+1 to Forgotten at R+2. If the operation write loses after
any catalog mutation, the whole transaction must roll back.

| Saved phase | Evidence needed to advance | Result |
| --- | --- | --- |
| Dataset ensure pending | Same saved provider name, adopted UUID and complete owner permissions | Prepare the document operation. |
| Document add pending | Exact document UUID and full content digest matching the admitted source | Prepare indexing evidence. |
| Cognify pending | Exact saved operation, input snapshot and completed provider run receipt | Permit catalog adoption. |
| Catalog commit pending | Current authority, revisions and completed provider evidence | Publish one Active fact; Correct also retires the old fact from recall. |
| Prior document delete pending | Exact absence of the corrected document | Finish correction cleanup. |
| Document delete pending | Exact absence of the forgotten document | Permit catalog finalization. |
| Catalog finalize pending | The fact remains ForgetPending at the expected revision | Mark it Forgotten. |
| Completed | Same admitted command | Return the saved result without an effect. |
| Recovery required | Explicit matching recovery evidence and current authority | Advance only through the operation owner; elapsed time alone permits nothing. |

Every provider effect is preceded by a check of the current operation and dataset authority.
Definite pre-dispatch failure and an uncertain dispatched effect remain different outcomes.
Uncertain Add or Delete performs reconciliation reads; it does not blindly resend the mutation.

## Save indexing evidence before dispatch

Cognee's current random run ID is first returned in the response. Losing that response therefore
loses the caller's ability to identify its run. The candidate extension uses the existing document
list, dataset lock and pipeline-run history to close that gap.

1. Save the exact Add receipt, including document UUID and content digest.
2. Read the gateway's existing document-list operation with a provider-created input evidence
   digest. The same snapshot includes each document's UUID, name, media type, content digest and
   byte length. It exposes no provider-private metadata or raw content.
3. Require the intended document and its saved content digest in that snapshot. Save a new indexing
   operation UUID and the snapshot digest durably before the first indexing request.
4. Send `{datasetId, operationId, expectedInputEvidenceDigest}`. Every recovery attempt uses those
   same saved values.
5. Under its existing dataset lock, the provider derives the run ID from the authorized pipeline
   coordinates and operation UUID. It reads the complete ordered history for that exact run.
6. For a new run, recompute the current input digest under the lock. A stale snapshot is rejected
   before Started is written or a task is dispatched. An admitted run saves both the request-profile
   digest and input-evidence digest in its existing run history.
7. A matching completed history returns its saved dataset, operation, run and input-evidence
   coordinates without another task, model or embedding call. A later dataset change does not alter
   what that earlier receipt proves.

The provider's versioned input digest binds the complete sorted document set, raw content digests
and lengths, and the private metadata/status that affects input selection. Data UUIDs alone are
insufficient because content and processing state can change under the same UUID.

An abandoned Started run, inconsistent history, missing evidence or contradictory terminal state
remains an ambiguous recovery failure. It must not become a pre-dispatch rejection. The gateway
must preserve that distinction in its error response. An Errored history cannot become Completed.
Dataset-latest status, Add completion, document presence and search results are not indexing proof.

This candidate relies on one provider worker and replica with the existing local store and dataset
lock. It makes no claim about admission across multiple provider workers.

## Recall, correction and forgetting

Recall is a built-in tool strategy within the existing ToolInvocation lifecycle. It is not an MCP
assignment. Every invocation needs the existing permission receipt bound to its exact query, input
snapshot, persona, invocation, actor and expiry. Dispatch uses only the personal dataset frozen in
that admitted run and rechecks the current claim and memory authority.

Proposal, dispatch and result admission have distinct evidence requirements. A permitted proposal
can open the permission question before its answer exists. The search dispatch requires the active
receipt, and result completion consumes it. The conversation's current dispatch authority is shared
by proposal and result admission, so the memory strategy must preserve these stages rather than
requiring an already-approved receipt before the question can be created.

After search, the server keeps only returned documents whose catalog rows remain Active and
consented in that exact dataset. Unknown, Corrected, ForgetPending and Forgotten documents cannot
enter the tool result. Provider failure remains failure rather than an empty successful recall.
The final catalog check, invocation completion and permission-receipt consumption share one atomic
transaction through their existing owners. Recall completion and Forget therefore have one durable
order. Content uses the existing protected result channel, never a plaintext memory SQL field.

Correct first adds and indexes the new source. It atomically publishes the replacement and changes
the old fact to Corrected, then removes the old provider document. Uncertain cleanup cannot make the
old fact visible again. Forget first changes the fact to ForgetPending in the admission transaction,
which immediately excludes it from recall. Only exact provider absence permits Forgotten.

## Delivery and proof

The domain owns operation policy and persistence. A workflow contract owns stable task identity and
identifier-only inputs. The workflow implementation uses injected domain, source-reader and gateway
ports; it imports neither Prisma nor the provider SDK. The app composes those owners and mounts the
authenticated routes. New packages follow the existing functional folder and Nx boundary rules.

Source validation must cover concurrent admission, command replay, changed input, current authority,
stale revisions, every lifecycle transition and restart after each effect checkpoint. Provider tests
must prove response loss and concurrent retries produce no extra paid work, including Started after
restart and Errored replay. The completed journey must prove Remember, a restart, separately approved
recall in another conversation, Correct, Forget and absence after another restart.

Deployment of the candidate image, authentication/storage profile and gateway credential projection
is a separate gate. Existing testv5 data must be preserved. Source checks and a disposable provider
qualification do not authorize replacing a live silo or deleting its data.

> See also: [MVP delivery plan](mvp-delivery-plan.md),
> [memory gateway](../../apps/memory-gateway/README.md),
> [Cognee candidate](../../apps/_infra/cognee/README.md).
