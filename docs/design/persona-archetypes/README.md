# Persona archetype templates

This directory contains the reviewed SOUL.md, AGENT.md, and bootstrap.md templates for each
colour archetype. These are the source material for the `PersonaSoulTemplate` database records.

## Architecture

```
SOUL.md    — Who the agent is. Loaded every turn. <500 tokens. Rarely changes.
AGENT.md   — How the agent works. Loaded every turn. Operational rules. Changes with task.
bootstrap.md — First-session script. Used once at onboarding. Disposable after first conversation.
```

## Template naming

Templates follow the pattern `{colour}-{modifier}`:
- `commander-explorer`, `commander-guardian` (Red)
- `catalyst-explorer`, `catalyst-guardian` (Yellow)
- `anchor-explorer`, `anchor-guardian` (Green)
- `analyst-explorer`, `analyst-guardian` (Blue)

The modifier (Explorer/Guardian) adjusts the Openness dimension the colour model cannot capture.

## Token budget

Each SOUL.md template targets **300–500 tokens** — enough for consistent personality expression,
small enough to avoid instruction dilution over long conversations. Research shows concise prompts
with moderate trait intensity outperform longer or more extreme prompts (Big5-Scaler,
arXiv:2508.06149).

AGENT.md is shared across all archetypes (operational rules don't change with personality) and
targets **200–400 tokens**.

bootstrap.md is loaded only for the first session and can be longer (up to 800 tokens) since it
is not a recurring cost.

## What belongs where

| Content | File | Rationale |
|---|---|---|
| Communication style, tone, challenge level | SOUL.md | Core identity — stable, loaded every turn |
| Response structure, information ordering | SOUL.md | Directly personality-driven |
| Approval boundaries, initiative level | AGENT.md | Operational — same across personality variants |
| Tool preferences, working habits | AGENT.md | Operational |
| Topic-specific style preferences | Memory | Discovered through interaction, changes over time |
| Contextual variations | Memory | "Prefers directness on technical topics" |
| Corrections and feedback history | Memory | Evolving, selectively retrieved |
| Relationship evolution | Memory | Dynamic, grows across sessions |

> See also: [persona-sorting-quiz.md](../persona-sorting-quiz.md),
> [persona-memory-boundary.md](../persona-memory-boundary.md)
