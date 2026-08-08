# Persona archetype templates

This directory contains reviewed SOUL, AGENT, and bootstrap authoring material for each colour
archetype. These Markdown files are not mutable runtime authorities.

## Architecture

```
SOUL source ──> PersonaSoulTemplate ──> compiled immutable PersonaRevision
AGENT source ─> authoring/evaluation reference only; not currently loaded at runtime
bootstrap ────> reviewed one-time conversation source; answers remain evidence
```

Only an explicitly approved persona revision can enter a future `RunInputSnapshot`. Source-file
changes do not mutate an active revision or an already admitted run.

## Template naming

Templates follow the pattern `{colour}-{modifier}`:
- `commander-explorer`, `commander-guardian` (Red)
- `catalyst-explorer`, `catalyst-guardian` (Yellow)
- `anchor-explorer`, `anchor-guardian` (Green)
- `analyst-explorer`, `analyst-guardian` (Blue)

The modifier (Explorer/Guardian) adjusts the user's stated novelty-versus-proven-method preference.
These are the only eight SOUL templates: a tied modifier score requires an explicit, provenance-
linked user choice between Explorer and Guardian before draft creation. There is no automatic
Balanced modifier or unmodified colour template.

## Template variables

SOUL.md templates contain `{{variables}}` compiled from reviewed quiz choices at draft time. Five
variables personalise each template beyond the archetype default:

- `{{response_style}}` — how information is delivered (Q2)
- `{{feedback_approach}}` — how critical feedback is framed (Q3)
- `{{challenge_mode}}` — how the agent pushes back (Q8)
- `{{relationship_frame}}` — the relationship model (Q9)
- `{{secondary_blend}}` — one line reflecting the secondary colour influence

The archetype provides the frame (tone, energy, what-to-avoid); variables calibrate the specific
behavioural dials within that frame. A Commander who prefers step-by-step explanations gets that
reflected without losing the Commander's directness and confidence.

The target compiler is a governed domain boundary, not string replacement in transport code. It
accepts only the reviewed directive mapping pinned to the completed interview and never inserts raw
user text. The Markdown title and display-only archetype/modifier names are authoring metadata and
are excluded from compiled runtime instructions. Every template must contain each of the five
documented placeholders exactly once. Missing, duplicated, unknown, or unresolved placeholders fail
closed and create no persona revision. The immutable revision pins the scoring-policy,
tie-resolution, template, and interpolation-map versions and digests alongside the compiled
instructions. This weighted compiler is not production-composed yet.

See the [quiz design](../persona-sorting-quiz.md#template-variables) for the full mapping table.

## Gender and demographics

SOUL.md templates are **not** differentiated by gender or other demographic attributes. The sorter
asks for collaboration preferences directly instead of using demographics as scoring inputs.

Excluding gender from scoring does not make the design bias-free. The audit boundary covers quiz
wording and weights, tie-resolution UX, archetype-label appeal, template directives, compilation,
and adaptation outcomes. Test these across voluntary self-identified genders and relevant
intersections using context-specific quality and satisfaction measures; do not infer gender or
force equal archetype distributions. See the [gender and demographic design guidelines](../soul-file-design-guidelines.md#8-gender-and-demographic-considerations)
and [gender research note](../../research/ai-persona-onboarding-research.md#7-gender-and-ai-persona-personalisation).

## Token budget

Each compiled SOUL template targets **300–500 tokens** as an explicit recurring-context budget.
Behavioural evaluation must confirm that the bounded instructions remain clear and stable; the
budget is not itself evidence of effectiveness. Variable compilation replaces existing lines
rather than adding new ones, so token count stays within budget.

AGENT authoring guidance is shared across all archetypes. It is not a recurring prompt payload and
therefore has no runtime token budget. It may document approval and memory boundaries for authors
and tests but cannot implement or relax their server-owned policy. Runtime use would first require
a versioned, digest-bound server model and snapshot coordinate.

The reviewed bootstrap source is used only for the first session and can be longer (up to 800
tokens) because it is not recurring context.

## What belongs where

| Content | File | Rationale |
|---|---|---|
| Communication style, tone, challenge level | Reviewed SOUL source | Compiled into the immutable persona revision |
| Response structure, information ordering | Reviewed SOUL source | Compiled from reviewed quiz evidence |
| Approval boundary | Server policy and proof-bound approval | Persona text never grants authority |
| Proposal/approval boundary | Server policy, documented in shared AGENT guidance | Non-negotiable floor: suggestions remain proposals and proof-bound approval still governs action |
| Initiative framing | Reviewed SOUL source | Tunes novelty, cadence, and presentation only within the shared proposal-only floor |
| Working habits | Shared AGENT authoring guidance | Defines conformance expectations without claiming current prompt wiring or granting authority |
| Topic-specific style preference | Candidate memory proposal | Requires explicit reviewed confirmation before retention |
| Contextual variation | Candidate memory proposal | Must name exact source, sensitivity, and intended use |
| Correction or feedback | Conversation evidence | May justify a narrow proposal; is not an automatic write |

> See also: [SOUL file design guidelines](../soul-file-design-guidelines.md),
> [persona-sorting-quiz.md](../persona-sorting-quiz.md),
> [persona-memory-boundary.md](../persona-memory-boundary.md)
