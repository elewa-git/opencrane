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
2. **Fast.** 10 questions, ~3 minutes. This count bounds onboarding effort; it is not a claim of
   psychometric coverage or validity.
3. **Blend-aware.** Output a primary + secondary colour, not a hard single label. Most people are
   a blend; forcing one bucket misclassifies borderline results.
4. **Governed.** Answers are append-only, provenance-linked evidence. The resulting persona goes
   through the existing draft → review → approve cycle before activation.
5. **Revisable.** Users can re-sort at any time through a persona refresh.

This is a custom product-preference sorter, not a Big Five assessment, clinical instrument, or
validated psychometric test. Its scores describe only how the reviewed answer weights below map to
OpenCrane's communication templates. It does not inherit scientific validity from any personality
framework, and results must never be presented as measurements of the user's personality.

## Scoring algorithm

Weighted-points scoring with lossless score retention:

1. Each reviewed answer choice contributes exactly the non-zero colour and Explorer/Guardian
   weights printed beside that choice. Unlisted counters receive zero; an answer need not affect
   all counters or either modifier counter.
2. Sum the integer weights without rounding. The raw colour vector is
   `C = { red, yellow, green, blue }`; the raw modifier vector is
   `O = { explorer, guardian }`.
3. Let `colourTotal = red + yellow + green + blue`. `colourTotal` must be greater than zero. The
   exact normalised percentage for colour `c` is `100 × C[c] / colourTotal`.
4. Let `opennessTotal = explorer + guardian`. `opennessTotal` must be greater than zero. The exact
   Explorer score is `100 × explorer / opennessTotal`; the Guardian score is
   `100 × guardian / opennessTotal`. Raw integers and denominators are authoritative; rounding is
   presentation-only and never affects ordering or tie detection.
5. Select the highest raw colour as primary and the highest remaining raw colour as secondary.
   Resolve any tie at either selection boundary through the governed user-choice flow below.
6. Select Explorer when `explorer > guardian` and Guardian when `guardian > explorer`. An exact tie
   is not a third modifier; it requires an explicit user choice between Explorer and Guardian.
7. Map the resolved primary colour and modifier to exactly one of the eight reviewed SOUL
   templates. The resolved secondary colour supplies `{{secondary_blend}}`.

### Tie resolution

Ties must not be broken by template ID, catalogue order, rule priority, random choice, or a
demographic attribute. Before draft creation:

- A primary tie presents only the tied-highest colours and asks the user which collaboration style
  they prefer.
- After the primary is resolved, a secondary tie presents only the tied-highest remaining colours.
- An Explorer/Guardian tie presents those two working-style options without inventing a
  "Balanced" template.

Each choice is appended as provenance bound to the completed interview, scoring-policy version,
candidate set, selected value, user identity, and trusted timestamp. Until every required tie is
resolved, draft creation returns a stable `resolution_required` outcome and creates no persona
revision. Replaying the same completed interview and tie evidence must produce the same result.

### Scoring authority and persisted result

The current `PrismaPersonaDraftTemplateSelectorRepository` is an exact-answer rule matcher; it is
not a weighted scorer or template compiler. Do not encode this algorithm by enumerating answer
combinations in `selectionRules` or by relying on rule priority.

Introduce a domain-owned scorer and compiler behind the persona authority. The scorer consumes one
completed interview, its exact reviewed question-set revision, and a reviewed scoring-policy
revision in the same transaction snapshot. Its immutable result must retain:

- question-set ID/version and scoring-policy ID/version/digest;
- the ordered answer IDs and exact reviewed choice IDs used;
- raw colour counters, `colourTotal`, and the lossless normalisation inputs;
- raw Explorer/Guardian counters, `opennessTotal`, and the lossless normalisation inputs;
- every tie candidate set and its append-only user-resolution evidence;
- resolved primary colour, secondary colour, and Explorer/Guardian modifier;
- selected template ID/version/digest; and
- the reviewed interpolation-map version/digest plus the answer IDs used for each variable.

This score-and-resolution evidence is pinned to the immutable persona revision. Approval must
recompute or rebind the same reviewed inputs and fail closed if the answers, policy, tie evidence,
template, interpolation map, or digest no longer matches.

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

### Axis 4: Proposal initiative

**Q7 — Suggestion cadence**
*How proactively should your assistant surface ideas and recommendations?*

- (a) Bring me a concrete recommendation without waiting to be asked. → Red +2, Yellow +1
- (b) Suggest options when relevant and wait for my decision. → Blue +2, Green +1
- (c) Check whether I want suggestions before expanding the topic. → Green +2, Blue +1
- (d) Surprise me with ideas I hadn't thought of, but let me choose. → Yellow +2, Explorer +1

This question changes proposal cadence only. No answer grants a capability, authorises an action,
or weakens the current proof-bound approval checkpoint.

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

SOUL.md templates contain `{{variables}}` compiled from reviewed quiz choice IDs during draft
generation. This personalises each template beyond the archetype default — a Commander who prefers
step-by-step explanations gets that reflected, rather than being forced into the archetype's
default conclusion-first style. The archetype provides the frame (tone, energy, what-to-avoid);
the variables calibrate the specific behavioural dials. Raw user text is never inserted.

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
| (a) Sharp tool | assistant |
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

Variables are compiled during the `POST .../draft` step, after scoring, tie resolution, and template
selection. The compiler accepts only reviewed choice IDs and reviewed directive values; it never
inserts raw user-authored text. It excludes the Markdown title and display-only archetype/modifier
names from runtime instructions. Each selected template must contain the exact five-placeholder set
documented here, with every placeholder appearing once. Draft creation fails closed when a mapping
is absent, a placeholder is missing or duplicated, an unknown placeholder appears, a display label
leaks into the runtime payload, or any `{{...}}` token remains after compilation.

The archetype-aligned mapping value should match the reviewed default behaviour. A Commander who
picks Q2(a) therefore receives the familiar conclusion-first directive, while a Commander who picks
Q2(c) receives the reviewed step-by-step directive without changing the template source itself.

## Score interpretation

After scoring:

1. Retain the raw colour and modifier counters plus their denominators as the authoritative vector.
2. Derive colour percentages using `100 × colour points / colourTotal` and the Explorer score using
   `100 × explorer / opennessTotal`.
3. Rank colours using unrounded raw counters; require governed user resolution at primary or
   secondary ties.
4. Select Explorer or Guardian by the greater raw modifier counter; require governed user
   resolution when the counters are equal.

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

There is no automatic Balanced modifier and no unmodified colour template. A tied modifier vector
must be resolved by the user before one of these eight templates is selected.

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

The quiz extends OpenCrane's existing persona onboarding lifecycle while preserving its immutable
revision and approval authority:

- Questions are added to the reviewed question set (version bump of
  `PERSONA_ONBOARDING_QUESTION_SET_VERSION`).
- Each question revision owns its reviewed choice IDs. One scoring-policy revision owns the weights
  keyed by exact `(questionId, choiceId)` pairs. The answer boundary accepts only a choice belonging
  to the interview's pinned question-set revision; free text, stale choices, and unknown choices
  fail before persistence.
- Answers remain append-only interview evidence. A domain-owned scoring result and any tie choices
  add derivation provenance; they do not overwrite or reinterpret the answers.
- The exact-match `PersonaDraftTemplateSelectorRepository` remains valid for its current contract,
  but weighted scoring and compilation use dedicated domain ports. The resolved colour/modifier
  selects one exact reviewed template without pretending the raw answers are selection rules.
- The compiler replaces only the five reviewed variables and rejects incomplete output. Draft
  generation atomically pins the scoring result, tie evidence, selected template, compiled
  instructions, and provenance-linked insights in a reviewable immutable revision.
- Approval goes through the existing `PersonaDraftTemplateSelection` → approve cycle.

In the target implementation, the eight colour-and-modifier SOUL templates replace the two current
templates (`direct-partner` and `supportive-partner`) in the reviewed catalogue. The shared AGENT.md
is operational guidance, not a ninth SOUL template.

## Question set governance

The question set is reviewed, versioned, and immutable per version. Changes to questions require a
new version. Active interviews resume against the version they started with. This is already
enforced by the existing `PERSONA_ONBOARDING_QUESTION_SET_VERSION` mechanism.

The scoring policy and interpolation map are reviewed, versioned inputs too. Changing a question or
choice creates a new question-set revision; changing a weight, normalisation rule, or tie policy
creates a new scoring-policy revision; changing a directive value creates a new interpolation-map
revision. An existing interview never silently moves to any of them.

## Conformance tests

Implementation is not complete until the public interview → complete → resolve (when required) →
draft path proves all of the following:

1. **Exact accumulation and normalisation.** Q1(a), Q2(a), Q3(a), Q4(a), Q5(a), Q6(a), Q7(a),
   Q8(a), Q9(a), Q10(a) produces `{ red: 23, yellow: 3, green: 0, blue: 7 }`,
   `colourTotal = 33`, exact percentages `{ red: 2300/33, yellow: 300/33, green: 0,
   blue: 700/33 }`, `{ explorer: 6, guardian: 0 }`, and `opennessTotal = 6`. The result is
   Commander/Blue/Explorer and selects `commander-explorer`. Display rounding cannot change it.
2. **Listed counters only.** Every reviewed choice adds exactly its printed weights and zero to all
   unlisted counters.
3. **Primary tie.** Q1(a), Q2(a), Q3(a), Q4(a), Q5(a), Q6(a), Q7(b), Q8(c), Q9(c), Q10(d)
   produces Red=13 and Blue=13. Draft creation returns `resolution_required`; each allowed user
   choice is persisted as provenance and replay selects the corresponding template.
4. **Secondary tie.** Q1(a), Q2(a), Q3(a), Q4(a), Q5(a), Q6(a), Q7(a), Q8(a), Q9(c), Q10(b)
   produces `{ red: 18, yellow: 6, green: 3, blue: 6 }`. Red is primary; only Yellow and Blue are
   offered for secondary resolution, and the selected value is retained as evidence.
5. **Modifier tie.** Q1(a), Q2(a), Q3(a), Q4(a), Q5(c), Q6(c), Q7(a), Q8(a), Q9(a), Q10(a)
   produces `{ explorer: 2, guardian: 2 }`. The flow offers only Explorer and Guardian, creates no
   Balanced result, and cannot draft before resolution.
6. **Invalid choice.** Unknown, stale-version, free-text, duplicate, and cross-question choice IDs
   are rejected without appending an answer or changing interview progress.
7. **Compiler completeness.** All eight templates compile every valid variable combination with no
   remaining placeholder or display-only archetype/modifier name. Missing, duplicated, unknown, or
   unresolved placeholders, leaked display labels, and missing mapping values return a stable
   failure and persist no revision.
8. **Immutable replay.** The same interview, policy, and tie evidence always reproduce the same
   score vector and compiled instructions. A changed policy, template, mapping, digest, or tie
   choice fails approval rather than mutating an existing draft.
