# Design guidelines for SOUL files and agent personalities

Status: **draft** — August 2026

These guidelines govern how OpenCrane designs, writes, tests, and evolves the personality files
that define personal agent behaviour. They apply to SOUL.md templates, AGENT.md operational
rules, bootstrap scripts, and the memory-based adaptation layer. The guidelines are grounded in
the [AI persona onboarding research](../research/ai-persona-onboarding-research.md) and
distilled from the archetype template library, sorting quiz design, and memory boundary
specification.

> See also: [persona archetype templates](persona-archetypes/README.md),
> [sorting quiz](persona-sorting-quiz.md),
> [memory boundary](persona-memory-boundary.md),
> [research report](../research/ai-persona-onboarding-research.md)

## 1. File architecture

Four files, four concerns. Never combine them.

| File | Purpose | Loaded | Budget | Update cadence |
|---|---|---|---|---|
| **SOUL.md** | Who the agent is — personality, voice, style | Every turn | <500 tokens | Rare — governed refresh cycle |
| **AGENT.md** | How the agent works — approval, initiative, boundaries | Every turn | <400 tokens | Per-task or operational change |
| **bootstrap.md** | First-session onboarding script | Once | <800 tokens | Never (disposable after use) |
| **Memory** | Learned preferences, contextual variations | Selectively retrieved | ~100–500/turn | Every ~3 conversations |

**Total always-loaded persona cost**: ~650 tokens. With retrieved memory: ~750–1150 tokens per
turn. Compare to monolithic approaches: typically 1500–3000 tokens, much of it irrelevant per
turn, with documented instruction-dilution effects.

### 1.1 Why the split matters

SOUL.md is a token budget. Every token in it costs across every interaction for the lifetime of
the agent. Memory is selectively retrieved — tokens are spent only when relevant facts are
pulled into context. AGENT.md separates operational rules (which are personality-independent)
from identity (which is personality-driven). This prevents personality changes from accidentally
altering safety boundaries and vice versa.

### 1.2 What belongs where

| Content | File | Why |
|---|---|---|
| Colour archetype and modifier name | SOUL.md | Activates the right associative cluster |
| Communication directives (3–5 lines) | SOUL.md | Must be consistently applied across all turns |
| Tone calibration (directness, warmth, formality) | SOUL.md | Primary personality dials |
| Challenge/pushback level | SOUL.md | Fundamental to the working relationship |
| Response structure preference | SOUL.md | Drives every answer's shape |
| What-to-avoid rules (3–4 lines) | SOUL.md | Prevents the most jarring personality violations |
| Approval boundaries | AGENT.md | Operational safety — must never be skipped |
| Initiative level defaults | AGENT.md | Action-vs-ask behaviour |
| Working habits | AGENT.md | Tool use, follow-up, memory policy |
| Boundary rules (honesty, access limits) | AGENT.md | Non-negotiable constraints |
| Topic-specific style preferences | Memory | Context-dependent, discovered through interaction |
| Corrections and explicit feedback | Memory | Evolving, selectively retrieved |
| Relationship evolution | Memory | Dynamic, grows across sessions |
| Domain terminology | Memory | Learned through corrections |

### 1.3 What is never stored

| Content | Why |
|---|---|
| General knowledge about the archetype | The model already knows what "direct and results-driven" means |
| Personality theory or framework explanations | Wastes tokens; adds nothing to behaviour |
| Elaborate backstory or character narrative | Research shows this degrades instruction-following |
| Duplicate information available from tools | Memory stores what the agent cannot re-derive |

## 2. Writing SOUL.md templates

### 2.1 Use archetype entailment for compression

Naming a well-chosen archetype (e.g., "direct, results-driven partner") activates pre-existing
associative clusters in the model. You do not need to spell out every implication — the model
infers vocabulary, reasoning patterns, and domain conventions from a concise archetype cue.
This is the primary compression mechanism. A 15-line SOUL.md with a well-named archetype
outperforms a 60-line specification that describes every behaviour explicitly.

### 2.2 Template structure

Every SOUL.md follows this structure:

```markdown
# SOUL — The [Archetype] ([Modifier])

[Identity line: 1 sentence. Adjectives + relationship frame + core values.]
[Secondary blend line: 1 sentence. What the secondary colour adds.]

## Communication style

- [Response delivery preference — from quiz variable {{response_style}}]
- [Format/structure preference — archetype-specific]
- [Depth/detail preference — archetype-specific]
- [Language register — archetype-specific]

## Challenge and feedback

- [Feedback framing — from quiz variable {{feedback_approach}}]
- [Pushback mode — from quiz variable {{challenge_mode}}]
- [Disagreement resolution — archetype-specific]

## Initiative

- [Proactive behaviour — archetype-specific, Explorer/Guardian-differentiated]
- [Suggestion framing — archetype-specific]
- [Urgency handling — archetype-specific]

## What to avoid

- [Personality violation 1 — the most jarring anti-pattern for this archetype]
- [Personality violation 2]
- [Personality violation 3]
```

### 2.3 Calibrate to moderate personality expression

The strongest empirical finding (Northeastern 2026, n=150): moderate personality expression
beats both flat/neutral and maximal/exaggerated. The SOUL template should sound like a
professional with a clear communication style, not a caricature.

- Write directives as behavioural instructions, not character descriptions.
- "Lead with the conclusion" is better than "You are an impatient, no-nonsense person."
- Avoid superlatives ("always", "never", "extremely") except in the what-to-avoid section.
- The what-to-avoid section is where strong language is appropriate — these are the violations
  that would break the user's trust.

### 2.4 Identity line

The identity line sets the entire frame. It combines:

1. **Adjectives** that activate the archetype cluster (2–3, from the archetype definition)
2. **Relationship frame** from the quiz (`{{relationship_frame}}` variable)
3. **Core values** that anchor the archetype (2–3 nouns)

Examples:
- "You are a direct, results-driven thinking partner who values speed, clarity, and bold thinking."
- "You are a calm, supportive trusted advisor who values patience, reliability, and proven methods."

The `{{secondary_blend}}` follows as a second sentence:
- "You also value precision and evidence-based reasoning on important decisions."

### 2.5 Behavioural directives

Write each directive as an imperative instruction that tells the agent what to do, not what it
is. The agent's identity comes from the identity line; the directives calibrate specific
behaviours within that identity.

| Good | Bad |
|---|---|
| Lead with the conclusion. | You are someone who gets to the point. |
| Start with what is working, then raise what needs attention. | You have a positive outlook and always look for the bright side. |
| State uncertainty explicitly. | You are an honest person who never pretends to know things. |

Keep directives to one line each. If a directive needs a sub-clause, that sub-clause should be
an example, not an explanation.

### 2.6 The what-to-avoid section

This is the personality's guardrail — the behaviours that would most jar the user. Three to four
lines maximum. Use "Never" deliberately here (it is the one section where strong language is
appropriate).

Each avoidance rule should describe a concrete behaviour, not an abstract quality:
- "Never pad responses with reassurance or unnecessary context." (concrete)
- "Never be unprofessional." (abstract — the model cannot act on this)

### 2.7 Explorer versus Guardian differentiation

The Openness modifier primarily affects the **Initiative** section. Explorer variants surface
novel approaches, suggest bold options, and are comfortable with ambiguity. Guardian variants
default to proven methods, flag untested approaches, and prefer predictability.

The Communication style and Challenge sections are personality-driven (from the colour
archetype) and do not change between Explorer and Guardian. The what-to-avoid section changes
only in one line: Explorers avoid excessive caution; Guardians avoid recommending unproven
approaches without flagging risk.

## 3. Template variables

SOUL templates contain `{{variables}}` interpolated from quiz answers at draft generation time.
Variables personalise each template beyond the archetype default — they capture intra-archetype
variation that the archetype selection alone misses.

### 3.1 Variable design principles

1. **Variables replace existing lines, not add new ones.** Token count stays within budget.
2. **The archetype provides the frame; variables calibrate the dials.** A Commander who prefers
   step-by-step explanations gets that reflected without losing the Commander's directness.
3. **Variable values are phrased as behavioural directives**, matching the surrounding template
   style. They are not raw quiz answers.
4. **When a quiz answer aligns with the archetype default, the variable value matches what the
   static template would have said anyway.** Personalisation only diverges where the user's
   specific preference diverges from the archetype norm.

### 3.2 Current variables

| Variable | Quiz source | What it calibrates |
|---|---|---|
| `{{response_style}}` | Q2 — Response preference | How information is delivered |
| `{{feedback_approach}}` | Q3 — Feedback preference | How critical feedback is framed |
| `{{challenge_mode}}` | Q8 — Challenge preference | How the agent pushes back |
| `{{relationship_frame}}` | Q9 — Relationship model | The working relationship identity |
| `{{secondary_blend}}` | Scoring result | One sentence reflecting the secondary colour |

See the [quiz design](persona-sorting-quiz.md#template-variables) for the full value mapping.

### 3.3 Adding new variables

Before adding a variable, verify:
- The quiz already captures a meaningful answer for this dimension.
- The variable value can differ within the same archetype (if all Commanders would get the same
  value, it should be a fixed archetype line, not a variable).
- The variable replaces an existing directive line (does not increase token count).
- The variable value can be phrased as a single-line behavioural directive.

## 4. Writing AGENT.md

### 4.1 AGENT.md is personality-independent

Operational rules do not change with the user's colour archetype. One AGENT.md serves all
archetypes. If you find yourself writing archetype-specific AGENT.md rules, the content belongs
in SOUL.md.

### 4.2 Structure

```markdown
## Approval boundaries
[What requires explicit user approval before acting]

## Initiative level
[Default action-vs-ask behaviour]

## Working habits
[Memory use, follow-up, thread tracking]

## Boundaries
[Non-negotiable constraints: honesty, access limits, data protection]

## Memory use
[When to store and surface learned preferences]
```

### 4.3 Boundaries are non-negotiable

The Boundaries section in AGENT.md cannot be overridden by SOUL.md personality directives. A
Commander's directness does not permit fabricating facts. An Anchor's patience does not permit
sharing data across contexts. The personality layer sits above the boundary layer, not below it.

This mirrors Anthropic's constitutional approach: HEXACO Honesty-Humility as a near-hard
constraint that the stylistic personality layer cannot override.

## 5. Writing bootstrap scripts

### 5.1 Purpose

A bootstrap script guides the agent's first conversation after persona approval. It establishes
the working relationship in the archetype's voice, captures initial calibration data for memory,
and is discarded after the first session.

### 5.2 Structure

```markdown
## Opening
[Self-introduction in archetype voice. 2–3 sentences. Set expectations.]

## First-session calibration (3 questions)
[Three questions that populate initial agent memory. Pacing matches archetype.]

## After calibration
[Summary of what was learned. One concrete offer to help. Match archetype tone.]

## What to store in memory
[Explicit list of what calibration answers produce as memory entries.]
```

### 5.3 Design rules

1. **Three calibration questions**, not more. The bootstrap is not a second interview.
2. **Questions capture what the quiz cannot**: current priorities, friction points, domain
   context, preferred support style — things that require open-ended answers.
3. **Pacing matches the archetype**: Commander asks all three fast; Anchor asks one at a time
   with space between.
4. **Answers go to memory, not SOUL.md.** Bootstrap calibration populates the agent's initial
   memory, not the personality file.
5. **The bootstrap is used once.** It does not recur in subsequent sessions.
6. **The closing offer is low-stakes and concrete.** Not "how can I help?" but a specific
   suggestion based on what the user described.

## 6. Archetype framework

### 6.1 The 2x2 + Openness structure

Four colour archetypes on a 2x2 grid, plus an orthogonal Openness modifier:

|  | Task / logic-focused | People / relationship-focused |
|---|---|---|
| **Fast / assertive** | Red — Commander | Yellow — Catalyst |
| **Reflective / steady** | Blue — Analyst | Green — Anchor |

Openness modifier (orthogonal to the grid):
- **Explorer**: novel approaches, creative suggestions, comfortable with ambiguity
- **Guardian**: proven methods, conservative, risk-aware, values predictability

This produces 8 template variants (4 colours x 2 modifiers).

### 6.2 Scoring substrate

Score users on continuous Big Five aspects internally (the scientific substrate), then present
results through colour archetype labels (the intuitive layer). This is the 16Personalities
pattern: scientifically grounded scoring with memorable, non-judgmental labels.

DISC has no counterpart to Big Five Openness — hence the separate Explorer/Guardian modifier.

### 6.3 Archetype naming

Archetype names must be:
- **Non-judgmental**: no colour is good or bad, no name implies superiority
- **Action-oriented**: Commander, Catalyst, Anchor, Analyst describe what the agent does
- **Gender-neutral**: names must not unconsciously code as masculine or feminine (see section 8)
- **Memorable**: a user should be able to recall their archetype name without looking it up

## 7. Adaptation and drift

### 7.1 Two update loops

| Loop | Speed | Governance | Content |
|---|---|---|---|
| **Core identity** (SOUL.md) | Slow — human-approved | Interview → draft → approve | Archetype, directives, tone, challenge level |
| **Contextual modulation** (Memory) | Fast — per-session | Agent-proposed, user-visible, revertible | Topic-specific preferences, contextual variations |

### 7.2 Memory update rules

1. **Cadence**: every ~3 conversations (empirically optimal per Tan et al., arXiv:2412.13103).
2. **Trigger**: update only when the agent's behaviour prediction was wrong (IRIS framework), or
   on explicit user feedback. Not on raw event counts.
3. **Scope**: only the implicated dimension is updated. Stability regulariser prevents
   oscillation across multiple dimensions at once.
4. **Visibility**: every learned preference is visible to the user, labelled with its source
   (bootstrap calibration, explicit feedback, inferred from interaction), and individually
   removable.

### 7.3 Adaptation signals (ranked by reliability)

1. **Direct edits/corrections** — highest signal, lowest ambiguity
2. **Explicit scoped ratings** — thumbs up/down, per-response
3. **Prediction-error-triggered behavioural signals** — session abandonment, reformulation
4. **Register/formality drift** — trackable but noisy, needs several turns
5. **Aggregate linguistic features** — real but weak (5–14% of trait variance), needs 100+
   messages

### 7.4 Persona drift mitigation

SOUL.md alone is not sufficient for long-term consistency. Self-consistency degrades 30%+ within
8–12 turns in documented settings. Architectural mitigations:

1. **Periodic persona re-injection**: re-surface core SOUL.md directives at regular intervals
   during long conversations (~25% consistency improvement).
2. **Persona vector monitoring**: detect when the agent's activation-space personality has
   drifted from the target.
3. **Sycophancy gate**: after any adaptation, compare affective alignment and epistemic
   independence separately. If warmth goes up but pushback goes down, the adaptation is suspect.

### 7.5 Sycophancy as the primary failure mode

Every paper that measures it finds personalising on affect/warmth increases agreement-seeking
behaviour. Mitigations:

- Separate epistemic-independence evaluation from affective-alignment evaluation
- Over-personalisation benchmarks: irrelevance, repetition, sycophancy rubric (OP-Bench)
- Warrant-based memory gating: sensitive history enters a response only when the current turn
  independently justifies it (HUSH-Bench)
- Honesty/integrity floor in AGENT.md that the SOUL.md stylistic layer cannot override

## 8. Gender and demographic considerations

### 8.1 No demographic segmentation in templates

SOUL.md templates are not differentiated by gender, age, culture, or other demographic
attributes. The sorting quiz captures individual preferences directly, which accounts for
whatever signal demographics would approximate. Within-gender variation in communication
preferences massively exceeds between-gender variation (75–100% distribution overlap, Weisberg
& DeYoung 2011; confirmed across 105 countries, Kajonius & Johnson 2019).

No major AI platform personalises by gender. No robust evidence shows gender-matched AI personas
improve satisfaction or task completion.

### 8.2 Gender-blind is not gender-neutral

Not personalising by gender is necessary but insufficient. Most AI platforms fail to test for
gender bias in their personalisation systems, resulting in male-default design — systems designed
and validated primarily with male users or male-normed assumptions that under-serve everyone
else without anyone noticing.

### 8.3 Required mitigations

1. **Gender-balanced quiz testing**: validate that question phrasing, answer options, and scoring
   weights produce equivalent archetype distributions across genders. If one gender
   disproportionately clusters in one archetype, investigate whether the quiz is measuring
   preference or reflecting socialised response patterns.

2. **Archetype label audit**: ensure names and descriptions do not unconsciously code as
   masculine or feminine. Test label appeal across genders. If a label repels a gender group
   despite matching their actual preferences, the label is the problem, not the user.

3. **Template language review**: audit SOUL template directives for gendered communication norms.
   "Push back when you see a better path" is neutral; "be aggressive in your recommendations"
   carries gendered connotations. Review what-to-avoid rules for assumptions about "normal"
   communication styles.

4. **Post-launch monitoring**: track archetype distribution, satisfaction scores, and re-sorting
   rates by gender. Disproportionate re-sorting from a specific gender signals the initial
   assignment is not working for them — the quiz or template, not the user, needs adjustment.

5. **Feedback loop parity**: ensure the adaptive memory system does not systematically
   under-weight feedback signals from users whose communication style differs from the training
   distribution.

### 8.4 Intersectionality

Gender interacts with culture, class, profession, and neurodivergence. Isolating any single
demographic dimension produces a crude proxy when the quiz can measure the actual preferences
directly. If post-launch data reveals archetype correlations with any demographic, that is the
quiz working correctly — it found their actual preference. Adding demographics as input would
risk overriding the quiz result with a stereotype.

## 9. Sorting quiz design principles

### 9.1 Framing

"How would you like your assistant to work with you?" — a preference-setting exercise, never a
personality diagnosis. No colour is good or bad. Users can re-sort at any time.

### 9.2 Quiz constraints

- **10 questions, ~3 minutes.** Industry precedent validates 10 as sufficient.
- **5 axes**: pace, focus, openness, initiative, working relationship.
- **Weighted-points scoring**: each answer adds weighted points to all four colour counters
  simultaneously. No answer is "wrong."
- **Continuous scores retained**: the full score vector is stored for re-sorting and potential
  fine-tuning, not just the discrete archetype label.
- **Primary + secondary + modifier output**: most people are a blend; hard single labels
  misfile borderline users.

### 9.3 Integration with templates

Quiz answers drive two outputs:
1. **Template selection**: primary colour + Openness modifier selects one of 8 SOUL templates.
2. **Variable interpolation**: specific quiz answers (Q2, Q3, Q8, Q9) fill `{{variables}}`
   within the selected template, and the secondary colour fills `{{secondary_blend}}`.

See the [quiz specification](persona-sorting-quiz.md) for the full question set, scoring
algorithm, and variable mapping.

## 10. Testing and validation

### 10.1 Template validation checklist

Before shipping a new or modified SOUL template:

- [ ] Token count is under 500 tokens (use a tokeniser, not word count)
- [ ] Identity line contains 2–3 adjectives, relationship frame variable, and 2–3 core values
- [ ] All `{{variables}}` are present and correctly named
- [ ] Directives are behavioural imperatives, not character descriptions
- [ ] What-to-avoid rules are concrete behaviours, not abstract qualities
- [ ] Explorer/Guardian differentiation is only in the Initiative and what-to-avoid sections
- [ ] Template reads as a professional with a clear communication style, not a caricature
- [ ] No gendered language or assumptions in directives

### 10.2 Archetype differentiation test

Generate the same prompt through all 8 SOUL templates. Verify:

- Responses are noticeably different in structure, tone, and information ordering
- No template produces responses indistinguishable from another
- Each template's what-to-avoid rules are visibly absent from its responses
- The Explorer/Guardian distinction manifests in suggestion framing, not just word choice

### 10.3 Variable injection test

For each template, test with both the archetype-aligned and archetype-divergent variable values:

- A Commander with `{{response_style}}` = "Walk through steps sequentially" should still feel
  like a Commander (direct tone, confident language) while delivering information step-by-step
- A Catalyst with `{{challenge_mode}}` = "name the risk directly" should still feel like a
  Catalyst (warm energy, collaborative framing) while being direct about risks

If the variable value contradicts the archetype identity, the surrounding archetype context
should modulate how the variable is expressed, not the other way around.

### 10.4 Drift test

Run a 20+ turn conversation with each template. Verify:

- Core personality traits are still recognisable at turn 20
- The what-to-avoid behaviours have not crept in
- Sycophancy has not increased (measure pushback frequency at turn 1 vs turn 20)
- Re-injecting the SOUL.md mid-conversation restores any drift that occurred

### 10.5 Gender bias audit

Before launch and at each major quiz or template revision:

- Run the quiz with a gender-balanced test panel
- Compare archetype distribution across genders
- Test archetype label appeal across genders (does "Commander" repel a gender group?)
- Review template language with a gender-bias lens
- Verify satisfaction and re-sorting rates do not skew by gender post-launch
