# Persona file versus agent memory boundary

Status: **draft** — August 2026

This document defines what belongs in the static persona files (SOUL.md, AGENT.md) versus what
should be stored in agent memory (dynamic, selectively retrieved, grows over time). The design
goal is minimal token cost for the always-loaded files while retaining rich, evolving
personalisation through memory.

> See also: [SOUL file design guidelines](soul-file-design-guidelines.md),
> [AI persona onboarding research](../research/ai-persona-onboarding-research.md),
> [persona archetype templates](persona-archetypes/README.md)

## Design principles

1. **Persona files are a token budget.** SOUL.md is loaded on every turn. Every token in it costs
   across every interaction for the lifetime of the agent. Target: <500 tokens.
2. **Memory is selectively retrieved.** Memory tokens are only spent when relevant facts are
   pulled into the current context. This makes memory the right home for anything
   context-dependent, topic-specific, or evolving.
3. **Archetype entailment compresses well.** Naming a well-chosen archetype (e.g., "direct,
   results-driven partner") activates pre-existing associative clusters in the model. You do not
   need to spell out every implication — the model infers vocabulary, reasoning patterns, and
   domain conventions from a concise archetype cue.
4. **Two update loops, not one.** The stable core (SOUL.md) changes only through the governed
   interview → draft → approve cycle. Contextual modulation (memory) changes per-session or
   per-3-sessions, agent-proposed, user-visible, and revertible.

## The boundary

### Always in SOUL.md (loaded every turn, <500 tokens)

| Content | Why it belongs here |
|---|---|
| Colour archetype and modifier name | Activates the right associative cluster via entailment |
| Core communication directives (3–5 lines) | Must be consistently applied across all turns |
| Tone calibration (directness, warmth, formality) | These are the primary personality dials |
| Challenge/pushback level | Fundamental to the working relationship |
| Response structure preference (big-picture vs detail) | Drives every answer's shape |
| What-to-avoid rules (3–4 lines) | Prevents the most jarring personality violations |

### Always in AGENT.md (loaded every turn, <400 tokens)

| Content | Why it belongs here |
|---|---|
| Approval boundaries | Operational safety — must never be skipped |
| Initiative level defaults | Determines action-vs-ask behaviour |
| Working habit defaults | Baseline expectations for tool use, follow-up |
| Memory use policy | Governs when to store and surface learned facts |
| Boundary rules (honesty, access limits) | Non-negotiable constraints |

### Always in Memory (selectively retrieved, grows over time)

| Content | Why it belongs here |
|---|---|
| Topic-specific style preferences | "Prefers directness on technical topics but warmth on people topics" — context-dependent |
| Contextual communication variations | Learned through interaction, not predictable from quiz answers |
| Corrections and explicit feedback | "User said: don't start with 'Great question'" |
| Working relationship evolution | How the relationship has changed over sessions |
| Project-specific context and priorities | Changes frequently, only relevant when that project is active |
| Learned communication patterns | What response length, format, vocabulary the user actually engages with |
| Bootstrap calibration answers | Current priority, friction points, preferred support style — from first session |
| Domain terminology preferences | Learned through corrections, not predictable from archetype |

### Never stored (derived on the fly)

| Content | Why |
|---|---|
| General knowledge about the archetype | The model already knows what "direct and results-driven" means |
| Detailed personality theory or framework explanations | Wastes tokens; adds nothing to behaviour |
| Elaborate backstory or character narrative | Research shows this degrades instruction-following |
| Duplicate information available from the codebase/tools | Memory should store what the agent cannot re-derive |

## Update cadence

### SOUL.md updates

- **Trigger**: User requests a persona refresh, or the agent proposes a `persona_refresh`
  configuration change.
- **Process**: Full interview → draft → review → approve cycle (existing PER-01 through PER-06).
- **Expected frequency**: Rare — quarterly at most, or when the user's work context changes
  significantly.

### Memory updates

- **Cadence**: Every ~3 conversations (optimal per AI Persona research, Tan et al.).
- **Trigger**: Prediction error (IRIS framework — only update when the agent's behaviour
  prediction for this user was wrong), or explicit user feedback.
- **Scope**: Only the implicated dimension is updated (stability regulariser prevents
  oscillation).
- **Visibility**: User can see, edit, and revert any learned preference.
- **Safeguards**:
  - Over-personalisation check: is this update irrelevant, repetitive, or sycophantic?
    (OP-Bench rubric)
  - Warrant check: does the current turn independently justify surfacing this memory?
    (HUSH-Bench)
  - Epistemic independence check: does this adaptation increase agreement-seeking behaviour?

## Token budget worked example

A Commander (Explorer) agent's always-loaded context:

| Component | Estimated tokens |
|---|---|
| SOUL.md (Commander Explorer) | ~350 |
| AGENT.md (shared operational rules) | ~300 |
| **Total always-loaded persona** | **~650** |
| Retrieved memory facts (0–5 per turn) | ~100–500 (variable) |
| **Total persona + memory per turn** | **~750–1150** |

Compare to a monolithic approach (everything in one file): typically 1500–3000 tokens, much of it
irrelevant to the current turn, with documented instruction-dilution effects on smaller models.

## Persona drift mitigation

A well-written SOUL.md is necessary but not sufficient for long-term consistency. Research
documents persona drift (self-consistency degrading 30%+ within 8–12 turns in some settings).

Architectural mitigations the runtime should implement:

1. **Periodic persona re-injection**: retrieve and re-surface core SOUL.md directives into context
   at regular intervals during long conversations (~25% consistency improvement in cited work).
2. **Persona vector monitoring**: detect when the agent's activation-space personality vector has
   drifted from the target (Anthropic persona vectors, arXiv:2507.21509).
3. **Sycophancy gate**: compare affective alignment and epistemic independence metrics separately
   after any adaptation — if warmth goes up but pushback goes down, the adaptation is suspect.
