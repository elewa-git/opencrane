# Persona source versus durable memory boundary

Status: **draft** — August 2026

This document defines the boundary between reviewed persona source material and durable personal
memory. `SOUL.md`, `AGENT.md`, and `bootstrap.md` in this design tree are authoring inputs and
examples, not independent runtime authorities or writable stores. OpenCrane keeps persona,
authorization, and memory lifecycle decisions in its server-owned contracts.

> See also: [SOUL file design guidelines](soul-file-design-guidelines.md),
> [AI persona onboarding research](../research/ai-persona-onboarding-research.md),
> [persona archetype templates](persona-archetypes/README.md)

## Design principles

1. **Reviewed source is not runtime state.** A reviewed SOUL source is persisted as a versioned
   `PersonaSoulTemplate`, compiled into immutable `PersonaRevision.compiledInstructions`, and
   activated only after the user approves that exact revision.
2. **Activation affects future runs only.** An approved persona revision enters only subsequently
   admitted `RunInputSnapshot`s. It cannot mutate an in-flight snapshot or conversation.
3. **Memory scope is snapshot-bound; recall is consent-bound.** Admission freezes only the verified
   gateway-native dataset coordinates. The model may choose a query only through the
   approval-required `memory_recall` tool. Recalled content is not compiled into the snapshot and
   awaits #601's transient safe-delivery path.
4. **Conversation is evidence, not consent.** A bootstrap answer, correction, or observed pattern may
   motivate a candidate preference proposal. It is never a direct durable write.
5. **Prompts never grant authority.** Persona instructions may affect communication style and
   proposal cadence, but they cannot create a capability, approval, or durable permission.

## The boundary

### Reviewed SOUL source

SOUL source may define the collaboration style that is compiled into an immutable persona revision:

| Content | Why it belongs here |
|---|---|
| Colour archetype and modifier name | Names the reviewed collaboration style |
| Core communication directives | Must be reviewed before activation |
| Tone calibration | Shapes presentation without changing authority |
| Challenge and pushback style | Shapes how evidence and disagreement are communicated |
| Response structure preference | Shapes answer organisation |
| What-to-avoid rules | Prevents known style violations |

The source file itself is not loaded or edited as durable runtime state. The approved immutable
`PersonaRevision.compiledInstructions` is the persona input referenced by future run snapshots.

### Shared AGENT guidance

AGENT source documents expected behaviour for template authors:

| Content | Boundary |
|---|---|
| Approval language | Describes the server checkpoint; it does not implement or relax it |
| Proposal/approval floor | Requires suggestions to remain proposals and preserves proof-bound approval |
| Working habits | Describe presentation and follow-up preferences |
| Memory guidance | Allows candidate proposals, never direct retention |
| Honesty and data-protection rules | Reinforce, but do not replace, server policy |

Every consequential action remains bound to current grants and the exact proof-bound approval
checkpoint for the run, capability, normalized action digest, decision owner, and expiry. A prior
conversation, persona instruction, or memory fact can neither satisfy nor waive that checkpoint.

### Candidate memory preferences

The following may be proposed for review when the conversation contains clear evidence:

| Candidate | Required evidence |
|---|---|
| Topic-specific style preference | Explicit statement or correction in an exact message |
| Response length or format preference | Explicit statement or confirmed candidate wording |
| Project terminology | Exact source plus confirmation that durable reuse is wanted |
| Bootstrap calibration preference | Exact answer, rewritten as a narrow candidate and reviewed |

The agent may explain why a candidate could be useful. It must not silently generalize a transient
statement, infer a stable trait from engagement, or report a candidate as remembered.

### Durable personal memory

A candidate becomes durable only through the platform memory lifecycle:

1. Show the user the exact candidate fact and its exact conversation or artifact source.
2. Classify its sensitivity and explain the intended future use.
3. Obtain explicit reviewed confirmation for that exact fact.
4. Assign stable provenance and an idempotency key.
5. Deliver through the memory gateway to the exact authenticated subject and Cognee dataset.
6. Complete the recoverable catalog metadata and outbox lifecycle with the gateway acceptance
   evidence and content digest.
7. Revalidate the active dataset coordinates at future run admission; select a query only through an
   approval-required per-run memory invocation.

OpenCrane now freezes verified dataset coordinates and requires one exact user approval before a
personal-memory invocation can proceed. The accepted invocation still stops at
`safe_delivery_required`; #601 must add transient content delivery without persisting recalled facts
in the run snapshot. Record, correction, forget, and their public management APIs remain blocked.
Until those paths exist, confirmed candidates remain conversation evidence and must not be
described as stored, editable, removable, indexed, or available for later recall.

### Never stored as persona memory

| Content | Why |
|---|---|
| Action approvals, grants, or access boundaries | Only current server authority can establish them |
| A guessed personality, intent, or sensitive trait | Model inference is not reviewed evidence |
| Gender inferred from name, voice, pronouns, text, or behaviour | It is sensitive, unreliable, and unnecessary for preference-based persona selection |
| Raw demographic audit data | Evaluation data has a separate purpose and governance boundary |
| General archetype theory | The reviewed template already supplies the relevant instructions |
| Duplicate tool or codebase facts | They should be resolved from their authoritative source |

An explicitly stated language or pronoun preference may be proposed as its own narrow preference
after confirmation; it must not be used to derive or retain a gender identity.

## Update lifecycle

### Persona revisions

- **Trigger**: the user requests a persona refresh or accepts a governed refresh proposal.
- **Process**: interview → draft → review → approve the exact immutable revision.
- **Activation**: only future admitted run snapshots reference the newly approved revision.
- **Prohibited shortcut**: neither a model-written file nor a memory fact may mutate the active
  persona outside this lifecycle.

### Memory candidates

- **Trigger**: an explicit user request, correction, or clear bootstrap answer may justify a
  candidate proposal.
- **No automatic cadence**: conversation counts and elapsed time do not authorize retention.
- **Scope**: keep the candidate narrow; do not infer adjacent traits or demographic attributes.
- **Review**: show exact content, source, sensitivity, and intended use before confirmation.
- **Persistence**: use only the gateway and catalog/outbox lifecycle when production writes become
  available; there is no direct Cognee or file fallback.
- **Effect**: a newly active fact can influence only a future snapshot that explicitly admits it.

## Gender and demographic audit boundary

Gender is an important evaluation dimension, not a persona input. OpenCrane must never infer gender
or place it in persona instructions, durable memory, prompt context, or a run snapshot. If research
collects optional self-described demographic data to audit outcomes, that data requires explicit
purpose-specific consent, access controls, aggregation and small-cell protection, a retention limit,
and an opt-out. It remains outside the operational persona and memory stores.

## Runtime consistency

The shipped persona-consistency mechanism is the immutable chain from reviewed template to approved
persona revision to admitted run snapshot. The target memory extension must first intersect every
gateway result with an active, consented catalog record and then freeze the matched identifiers and
digests. Only that joined evidence can give an operator an auditable explanation of which facts
affected a run; freezing unrelated catalog IDs and gateway references is insufficient. Drift,
sycophancy, and over-personalisation still require evaluation, but those evaluations cannot bypass
the approval or memory lifecycle above.
