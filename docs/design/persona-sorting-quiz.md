# Persona sorting quiz design

Status: **draft** — August 2026

A short, governed interview that maps users to one of four colour-coded agent archetypes (Red,
Yellow, Green, Blue) plus an Openness modifier (Explorer/Guardian). Produces a personalised,
reviewed SOUL.md template for the user's personal agent.

> See also: [SOUL file design guidelines](soul-file-design-guidelines.md),
> [AI persona onboarding research](../research/ai-persona-onboarding-research.md)

## Design principles

1. **Preference-setting, not personality diagnosis.** Frame as "how would you like your assistant
   to work with you?" — never "this is who you are." No colour is good or bad.
2. **Fast.** 10 questions, ~3 minutes. Industry precedent (Ally, Joii) validates 10 as sufficient.
3. **Blend-aware.** Output a primary + secondary colour, not a hard single label. Most people are
   a blend; forcing one bucket misgenders borderline users.
4. **Governed.** Answers are append-only, provenance-linked evidence. The resulting persona goes
   through the existing draft → review → approve cycle before activation.
5. **Revisable.** Users can re-sort at any time through a persona refresh.

## Scoring algorithm

Weighted-points scoring with continuous trait retention:

1. Each answer adds weighted points to all four colour counters simultaneously (a single answer can
   partially support multiple archetypes).
2. Openness questions score independently on a separate Explorer ↔ Guardian axis.
3. After all questions: normalise colour scores to percentages, select primary (highest) and
   secondary (second highest) colours.
4. Retain the full continuous score vector for future re-sorting and potential fine-tuning.
5. Map the primary colour + Openness modifier to the reviewed SOUL template. The secondary colour
   is stored as evidence and may influence future template refinements.

The existing `PrismaPersonaDraftTemplateSelectorRepository` already supports this: expand the
`selectionRules` to match on the new quiz answers, add templates to `PersonaSoulTemplate`, and
the deterministic priority-based rule matcher handles the rest.

## The 10 questions

### Axis 1: Pace (fast/assertive ↔ reflective/steady)

**Q1 — Decision speed**
*When you need to make a decision at work, which feels most natural?*

- (a) Decide quickly with the information I have — I can course-correct later. → Red +3, Yellow +2
- (b) Take time to consider the options carefully before committing. → Blue +3, Green +2
- (c) Talk it through with someone I trust, then decide together. → Yellow +2, Green +3

**Q2 — Response preference**
*When your assistant gives you an answer, what matters most?*

- (a) Get to the point fast — I'll ask if I need more. → Red +3, Blue +1
- (b) Give me the full picture with context and reasoning. → Blue +3, Green +1
- (c) Walk me through it step by step so I can follow along. → Green +3, Yellow +1
- (d) Start with the big idea, then I'll dive into details if interested. → Yellow +3, Red +1

### Axis 2: Focus (task/logic ↔ people/relationship)

**Q3 — Feedback preference**
*How do you prefer to receive critical feedback?*

- (a) Be direct — tell me what's wrong and how to fix it. → Red +3, Blue +1
- (b) Show me the evidence, then let me draw my own conclusion. → Blue +3, Red +1
- (c) Start with what's working, then raise what needs attention. → Green +3, Yellow +2
- (d) Frame it as an opportunity — what could we try differently? → Yellow +3, Green +1

**Q4 — Meeting energy**
*Which describes your ideal interaction with a colleague (or assistant)?*

- (a) Short, focused, outcome-driven — no small talk needed. → Red +3, Blue +2
- (b) Collaborative and energetic — bouncing ideas around. → Yellow +3, Red +1
- (c) Calm and supportive — taking time to understand each other. → Green +3, Yellow +1
- (d) Structured and thorough — covering everything systematically. → Blue +3, Green +1

### Axis 3: Openness (Explorer ↔ Guardian)

**Q5 — Approach to new ideas**
*When facing a problem you've solved before, what do you prefer?*

- (a) Try a completely new approach — there might be something better. → Explorer +3
- (b) Use what worked last time — why reinvent the wheel? → Guardian +3
- (c) Start with the proven method but be open to improvements. → Explorer +1, Guardian +1

**Q6 — Risk appetite**
*When your assistant suggests something, would you rather it…*

- (a) Suggest the bold, creative option and let me dial it back. → Explorer +3, Red +1
- (b) Suggest the safe, proven option and let me push it further. → Guardian +3, Blue +1
- (c) Present both and explain the trade-offs. → Guardian +1, Explorer +1, Blue +1

### Axis 4: Initiative and autonomy

**Q7 — Initiative level**
*How much should your assistant take the lead?*

- (a) Act first, explain later — I trust it to make good calls. → Red +2, Yellow +1
- (b) Suggest options and wait for my decision. → Blue +2, Green +1
- (c) Check in with me before doing anything significant. → Green +2, Blue +1
- (d) Surprise me with ideas I hadn't thought of, but let me choose. → Yellow +2, Explorer +1

**Q8 — Challenge preference**
*When you're heading down a path your assistant thinks is wrong, it should…*

- (a) Tell me directly — "I think this is a mistake, here's why." → Red +3, Blue +1
- (b) Ask thoughtful questions that help me see the issue myself. → Green +2, Yellow +2
- (c) Present the evidence and the alternative, then let me decide. → Blue +3, Green +1
- (d) Support my direction but flag the risk so I'm informed. → Green +3, Yellow +1

### Axis 5: Working relationship depth

**Q9 — Relationship model**
*Which best describes what you want from your assistant?*

- (a) A sharp tool — efficient, reliable, no personality needed. → Red +2, Blue +2
- (b) A thinking partner — someone who engages with my ideas. → Yellow +3, Explorer +1
- (c) A trusted advisor — someone who understands my context over time. → Green +3, Blue +1
- (d) A rigorous collaborator — someone who holds me to high standards. → Blue +2, Red +2

**Q10 — Tone preference**
*Pick the tone that would make you most comfortable working with an AI assistant every day:*

- (a) Confident and direct, like a no-nonsense colleague. → Red +3
- (b) Warm and enthusiastic, like an excited collaborator. → Yellow +3
- (c) Calm and steady, like a patient mentor. → Green +3
- (d) Precise and thorough, like a meticulous analyst. → Blue +3

## Template variables

SOUL.md templates contain `{{variables}}` that are interpolated from quiz answers during draft
generation. This personalises each template beyond the archetype default — a Commander who prefers
step-by-step explanations gets that reflected, rather than being forced into the archetype's
default conclusion-first style. The archetype provides the frame (tone, energy, what-to-avoid);
the variables calibrate the specific behavioural dials.

### `{{response_style}}` — from Q2 (response preference)

| Q2 answer | Variable value |
|---|---|
| (a) Get to the point fast | Lead with the conclusion. Context follows only if asked. |
| (b) Full picture with context | Open with context and reasoning before the recommendation. |
| (c) Walk me through it | Walk through steps sequentially, explaining the reasoning behind each one. |
| (d) Big idea first | Start with the big idea, then dive into details on request. |

### `{{feedback_approach}}` — from Q3 (feedback preference)

| Q3 answer | Variable value |
|---|---|
| (a) Direct | Be direct about what is wrong and how to fix it. |
| (b) Evidence-based | Present the evidence, then let the conclusion follow naturally. |
| (c) Positive-first | Start with what is working, then raise what needs attention. |
| (d) Opportunity-framed | Frame concerns as opportunities — "What if we tried this instead?" |

### `{{challenge_mode}}` — from Q8 (challenge preference)

| Q8 answer | Variable value |
|---|---|
| (a) Direct | name the risk directly and say "I think this is a mistake — here is why" |
| (b) Socratic | ask thoughtful questions that help the user see the issue themselves |
| (c) Evidence-then-decide | present the evidence and the alternative, then let the user decide |
| (d) Support-but-flag | support the chosen direction but clearly flag the risk |

### `{{relationship_frame}}` — from Q9 (relationship model)

| Q9 answer | Variable value |
|---|---|
| (a) Sharp tool | partner |
| (b) Thinking partner | thinking partner |
| (c) Trusted advisor | trusted advisor |
| (d) Rigorous collaborator | rigorous collaborator |

### `{{secondary_blend}}` — from scoring result (second-highest colour)

| Secondary colour | Variable value |
|---|---|
| Red | You also value efficiency and quick results when it serves the goal. |
| Yellow | You also bring creative energy and enjoy collaborative exploration. |
| Green | You also value patience and steady support when complexity increases. |
| Blue | You also value precision and evidence-based reasoning on important decisions. |

Variables are interpolated during the `POST .../draft` step, after template selection. The
archetype defaults (what currently appears in the templates) are the fallback when a quiz answer
happens to align with the archetype's natural style — so a Commander who picks Q2(a) gets the same
line as the old static template, but a Commander who picks Q2(c) gets a genuinely different SOUL.

## Score interpretation

After scoring:

1. Normalise each colour to a percentage of total colour points.
2. Normalise Openness to a 0–100 scale (0 = pure Guardian, 100 = pure Explorer).
3. Select primary colour (highest %), secondary colour (second highest %).
4. Select Openness modifier: Explorer if ≥60, Guardian if ≤40, Balanced if 41–59.

### Template mapping

| Primary colour | Openness | Template ID | Display name |
|---|---|---|---|
| Red | Explorer | `commander-explorer` | The Commander (Explorer) |
| Red | Guardian | `commander-guardian` | The Commander (Guardian) |
| Yellow | Explorer | `catalyst-explorer` | The Catalyst (Explorer) |
| Yellow | Guardian | `catalyst-guardian` | The Catalyst (Guardian) |
| Green | Explorer | `anchor-explorer` | The Anchor (Explorer) |
| Green | Guardian | `anchor-guardian` | The Anchor (Guardian) |
| Blue | Explorer | `analyst-explorer` | The Analyst (Explorer) |
| Blue | Guardian | `analyst-guardian` | The Analyst (Guardian) |

For "Balanced" Openness (41–59), use the primary colour's default template (without modifier),
which targets moderate personality expression — the empirically strongest setting
(Northeastern 2026).

## Result presentation

The result screen shows:

1. **Primary archetype** with colour and name (e.g., "The Analyst" in blue).
2. **Secondary influence** (e.g., "with Commander tendencies").
3. **Openness modifier** (e.g., "Explorer — you prefer creative approaches").
4. **3–5 provenance-linked insights** explaining how specific answers produced specific persona
   traits (e.g., "You said you prefer direct feedback → your assistant will challenge you openly
   rather than hedging").
5. **A clear "Review & Approve" gate** — the persona is not active until explicitly approved.
6. **A "Re-sort" option** — users can retake the quiz at any time.

## Integration with existing architecture

The quiz maps directly onto OpenCrane's existing persona onboarding system:

- Questions are added to the reviewed question set (version bump of
  `PERSONA_ONBOARDING_QUESTION_SET_VERSION`).
- Answers flow through the existing `PersonaInterviewAnswer` model.
- Template selection uses the existing `PersonaDraftTemplateSelectorRepository` with expanded
  `selectionRules`.
- Draft generation produces a reviewable immutable revision with provenance-linked insights.
- Approval goes through the existing `PersonaDraftTemplateSelection` → approve cycle.

The two existing templates (`direct-partner` and `supportive-partner`) are replaced by the 8+1
colour-archetype templates, which are richer expressions of the same underlying dimensions.

## Question set governance

The question set is reviewed, versioned, and immutable per version. Changes to questions require a
new version. Active interviews resume against the version they started with. This is already
enforced by the existing `PERSONA_ONBOARDING_QUESTION_SET_VERSION` mechanism.
