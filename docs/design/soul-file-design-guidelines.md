# Design guidelines for SOUL files and agent personalities

Status: **draft** — August 2026

These guidelines govern how OpenCrane designs, writes, tests, and evolves reviewed persona source
and its authoring guidance. SOUL.md templates are target compiler inputs, bootstrap scripts are
future one-session conversation sources, and AGENT.md is currently an authoring/evaluation reference
only. None is an independent runtime authority or mutable file inside an agent. The guidelines also
define the proposal-only boundary for contextual memory. They are grounded in the
[AI persona onboarding research](../research/ai-persona-onboarding-research.md) and distilled from
the archetype template library, sorting quiz design, and memory boundary specification.

> See also: [persona archetype templates](persona-archetypes/README.md),
> [sorting quiz](persona-sorting-quiz.md),
> [memory boundary](persona-memory-boundary.md),
> [research report](../research/ai-persona-onboarding-research.md)

## 1. File architecture

Four concerns. Never collapse their authority or lifecycle boundaries.

| Source | Purpose | Runtime treatment | Budget | Change cadence |
|---|---|---|---|---|
| **SOUL.md** | Reviewed personality, voice, and style source | Compiled into an immutable approved `PersonaRevision` | <500 tokens | Rare — governed refresh cycle |
| **AGENT.md** | Shared authoring and evaluation guidance | Not currently compiled or loaded at runtime; never grants authority | n/a | Governed product/configuration change |
| **bootstrap.md** | First-session interview source | Produces evidence and candidate proposals only | <800 tokens | Versioned product change |
| **Memory** | Explicitly confirmed contextual preferences | Admission freezes verified dataset coordinates; the model queries only through approval-required `memory_recall` | ~100–500/turn | User-reviewed proposal; transient content delivery awaits #601 |

The implementation must measure the compiled recurring instruction payload separately from any
future transient memory delivery. The limits above are design budgets, not empirically established
optima, and source-file token counts are not proof of the runtime payload.

### 1.1 Why the split matters

Compiled persona instructions are a token budget. Every approved token costs whenever that exact
revision is selected for a new run. Admission freezes only the verified user's dataset coordinates;
it does not select facts or store a recall query. The model can request recall only through the
approval-required `memory_recall` tool, while safe transient content delivery remains blocked until
#601. Operational rules remain separate from personality, and neither layer can create grants or
alter approval boundaries.

### 1.2 What belongs where

| Content | File | Why |
|---|---|---|
| Explicit behaviour dials represented by the display archetype | SOUL.md | Compiles intended behaviour without relying on the label's associations |
| Communication directives (3–5 lines) | SOUL.md | Must be consistently applied across all turns |
| Tone calibration (directness, warmth, formality) | SOUL.md | Primary personality dials |
| Challenge/pushback level | SOUL.md | Fundamental to the working relationship |
| Response structure preference | SOUL.md | Drives every answer's shape |
| What-to-avoid rules (3–4 lines) | SOUL.md | Prevents the most jarring personality violations |
| Server-owned approval boundaries | Server policy, documented in AGENT.md authoring guidance | Prompt text can explain but never establish the checkpoint |
| Proposal/approval floor | Server policy, documented in AGENT.md authoring guidance | Requires proposal-only suggestions and proof-bound approval for action |
| Initiative framing | SOUL.md | Tunes novelty, cadence, and presentation within that non-negotiable floor |
| Working-habit expectations | AGENT.md authoring guidance | Review/test reference only until a versioned runtime model exists |
| Boundary rules (honesty, access limits) | Server policy, documented in AGENT.md | Non-negotiable runtime constraints remain server-owned |
| Confirmed topic-specific style preferences | Memory | Context-dependent and explicitly reviewed |
| Confirmed corrections and feedback | Memory | Provenance-linked and selectively retrieved |
| Confirmed relationship preferences | Memory | User-controlled and individually removable |
| Confirmed domain terminology | Memory | Retained only after explicit review |

### 1.3 What is never stored

| Content | Why |
|---|---|
| General or stereotyped associations with an archetype | Unspecified entailment is not reviewed behaviour |
| Personality theory or framework explanations | Wastes tokens; adds nothing to behaviour |
| Elaborate backstory or character narrative | Research shows this degrades instruction-following |
| Duplicate information available from tools | Memory stores what the agent cannot re-derive |
| Inferred gender, sex, or demographic attributes | Audit data is never persona or memory evidence |

## 2. Writing SOUL.md templates

### 2.1 Prefer explicit behaviour dials over archetype entailment

Archetype names are useful display labels, but putting them in a prompt can activate unspecified
associations, including gender stereotypes. The compiler excludes the Markdown title and display
labels from runtime instructions. Specify directness, warmth, structure, challenge, and proposal
cadence as short behavioural directives that can be tested independently. Treat any residual
archetype cue as a compilation defect; never assume the model's inferred vocabulary, reasoning, or
social conventions are desired behaviour.

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

- [Proposal initiative framing — archetype-specific and Explorer/Guardian-differentiated, but
  always subordinate to the shared proposal-only and proof-bound approval floor]
- [Suggestion framing — archetype-specific]
- [Urgency handling — archetype-specific]

## What to avoid

- [Personality violation 1 — the most jarring anti-pattern for this archetype]
- [Personality violation 2]
- [Personality violation 3]
```

### 2.3 Calibrate to moderate personality expression

Moderate expression is a safer starting hypothesis than a flat or exaggerated caricature, but it
must be evaluated on OpenCrane's tasks, languages, and supported models. The SOUL template should
sound like a professional with a clear communication style.

- Write directives as behavioural instructions, not character descriptions.
- "Lead with the conclusion" is better than "You are an impatient, no-nonsense person."
- Avoid superlatives ("always", "never", "extremely") except in the what-to-avoid section.
- The what-to-avoid section is where strong language is appropriate — these are the violations
  that would break the user's trust.

### 2.4 Identity line

The identity line sets the entire frame. It combines:

1. **Behavioural adjectives** that name tested dials (2–3, from the archetype definition)
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

The Openness modifier changes only directives that express the user's novelty-versus-proven-method
preference. Explorer variants surface novel options and ambiguity; Guardian variants lead with
tested methods and flag unproven approaches. A reviewed identity or communication line may express
that same dial, but the modifier must not alter warmth, respect, challenge strength, response depth,
action authority, or approval requirements. Every pairwise difference must trace to this explicit
dial rather than an archetype stereotype.

## 3. Template variables

SOUL template source uses reviewed variable slots resolved at draft generation time. The compiler
maps immutable answer IDs to reviewed single-line directives; it never interpolates raw answer or
free-text content. Variables capture explicit preferences that the archetype selection alone misses.

### 3.1 Variable design principles

1. **Variables replace existing lines, not add new ones.** Token count stays within budget.
2. **The explicit answer controls its dial.** A user who selects step-by-step explanation receives
   that directive even when a display archetype has a different default. Unrelated tested dials
   remain stable.
3. **Variable values are phrased as behavioural directives**, matching the surrounding template
   style. They are not raw quiz answers.
4. **A specific preference overrides the template default on that dimension.** If this produces an
   incoherent combination, ask the user or revise the template; never silently reinterpret the
   explicit answer through an archetype stereotype.

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

### 4.1 AGENT.md is personality-independent authoring guidance

Operational conformance expectations do not change with the user's colour archetype. One AGENT.md
serves authors and evaluation across all archetypes. It is not currently compiled, loaded, or
pinned into a `PersonaRevision` or `RunInputSnapshot`; server policy owns the actual runtime
boundary. If runtime shared guidance is introduced later, it first needs a server-owned versioned
model, digest, activation lifecycle, and snapshot coordinate. If you find yourself writing
archetype-specific AGENT.md guidance, the stylistic content belongs in SOUL.md.

### 4.2 Structure

```markdown
## Approval boundaries
[How the server-owned approval checkpoint is presented; this file does not define it]

## Initiative level
[Non-negotiable proposal-only floor; SOUL may tune cadence, novelty, ordering, and phrasing but
never action authority]

## Working habits
[Memory use, follow-up, thread tracking]

## Boundaries
[Non-negotiable constraints: honesty, access limits, data protection]

## Memory use
[How to propose a candidate preference and use only facts admitted in the run snapshot]
```

### 4.3 Boundaries are non-negotiable

SOUL.md templates must conform to the shared AGENT authoring guidance, but neither source file can
override or implement server policy. A Commander's directness does not permit fabricating facts.
An Anchor's patience does not permit sharing data across contexts. Honesty, access limits, grants,
and approval checks remain server-owned boundaries regardless of the selected style.

## 5. Writing bootstrap scripts

### 5.1 Purpose

A bootstrap script guides the agent's first conversation after persona approval. It establishes
the working relationship in the approved persona's voice and gathers evidence that may support
user-reviewed preference proposals. It does not write memory.

### 5.2 Structure

```markdown
## Opening
[Self-introduction in archetype voice. 2–3 sentences. Set expectations.]

## First-session calibration (3 questions)
[Three questions that can support candidate preference proposals. Pacing matches archetype.]

## After calibration
[Summary of what was learned. One concrete offer to help. Match archetype tone.]

## Candidate preferences
[Explicit list of proposals the user may review; none is retained merely because it was answered.]
```

### 5.3 Design rules

1. **Three calibration questions**, not more. The bootstrap is not a second interview.
2. **Questions capture what the quiz cannot**: current priorities, friction points, domain
   context, preferred support style — things that require open-ended answers.
3. **Pacing matches the archetype**: Commander asks all three fast; Anchor asks one at a time
   with space between.
4. **Answers are evidence, not memory writes.** The agent may propose a candidate preference, but
   durable retention requires explicit reviewed user confirmation. Keep the current runtime status
   and target catalog-safe admission rule in the one shared AGENT authoring reference instead of
   copying it into every archetype bootstrap.
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

### 6.2 Product-specific preference scoring

Score only the interaction preferences asked by the OpenCrane sorter and retain those continuous
preference-axis scores for explanation and re-sorting. Big Five and DISC can suggest hypotheses,
but they do not validate this custom instrument. The BFAS measure used to establish the 10 Big Five
aspects has 100 items; OpenCrane's 10-item forced-choice sorter requires its own construct,
reliability, validity, and fairness evidence before any scientific claim.

The Explorer/Guardian modifier exposes novelty and risk appetite that the four-colour UX does not
represent clearly. It is a product preference axis, not a validated Big Five score.

### 6.3 Archetype naming

Archetype names must be:
- **Non-judgmental**: no colour is good or bad, no name implies superiority
- **Action-oriented**: Commander, Catalyst, Anchor, Analyst describe what the agent does
- **Gender-neutral**: names must not unconsciously code as masculine or feminine (see section 8)
- **Memorable**: a user should be able to recall their archetype name without looking it up

## 7. Adaptation and drift

### 7.1 Two governed proposal loops

| Loop | Proposal cadence | Governance | Runtime result |
|---|---|---|---|
| **Core identity** | Rare | Accepted refresh proposal → interview → draft → explicit review and approval | One immutable `PersonaRevision`, eligible only for future run snapshots |
| **Contextual preference** | When evidence warrants asking | Agent proposes one candidate; user explicitly reviews and confirms | Future consented memory fact, once a production write lifecycle exists |

Markdown files and conversation text are never runtime authority. Draft creation compiles the
reviewed SOUL content into immutable candidate `PersonaRevision.compiledInstructions`; approval
must validate and activate that exact already-compiled payload rather than recompiling changed
source. Each admitted run then freezes the exact approved `personaRevisionId`. The target memory
contract additionally freezes a gateway-native dataset, catalog-matched fact identifiers/digests,
and memory policy, but production injection remains blocked until admission proves that
catalog-to-gateway intersection. A later approval or confirmation cannot change an already
admitted run.

### 7.2 Preference-proposal rules

1. **Evidence is not consent.** Quiz answers, bootstrap answers, corrections, transcript patterns,
   and prediction errors may justify a proposal; none automatically creates a durable fact.
2. **Ask about one bounded preference.** State the candidate, scope, evidence source, and expected
   behavioral effect. Do not infer a personality trait or demographic identity.
3. **Require explicit reviewed confirmation.** A future write also requires sensitivity,
   provenance, exact source coordinate, idempotency, gateway acceptance, and catalog/outbox
   lifecycle. Silence, continued use, and a generic thumbs-up are not durable-memory consent.
4. **Preserve user control.** Confirmed facts must be visible, individually correctable and
   forgettable, and labelled with their source and scope once those production paths exist.
5. **Represent the current gap exactly.** Production record, correct, and forget operations and
   their public API/UI surfaces remain blocked and fail closed. Admission freezes verified dataset
   coordinates, and personal recall requires approval for the exact invocation and query. Content
   delivery still stops safely until #601; never imply that recalled facts are injected today or
   that the agent can write memory directly.
6. **Keep authority separate.** Persona text, prompts, memory, and initiative settings never grant
   permission to act. Consequential actions still require current grants and the exact proof-bound
   approval checkpoint.

### 7.3 Proposal signals (ranked by reliability)

1. **Direct edits/corrections** — strongest evidence for asking about the edited dimension
2. **Explicit scoped ratings** — useful only when the rated quality is unambiguous
3. **Prediction-error-triggered behavioral signals** — abandonment or reformulation can justify a
   question, not an inference
4. **Register/formality drift** — noisy; require repeated evidence and confirmation
5. **Aggregate linguistic features** — weak and unsuitable for demographic or trait inference

An experimental cadence such as every three conversations can schedule proposal review, but it
cannot schedule writes. Direct explicit feedback may justify asking sooner; weak signals may never
justify asking.

### 7.4 Persona drift mitigation

Compiled persona instructions alone may not remain behaviorally salient over a long conversation.
Evaluate mitigations without crossing the snapshot boundary:

1. **Snapshot-consistent re-injection**: re-surface only the compiled instructions already frozen
   for that run; never switch persona revisions mid-run.
2. **Behavior monitoring**: measure whether explicit directness, warmth, structure, challenge, and
   initiative dials remain stable, rather than relying on an opaque archetype vector alone.
3. **Sycophancy gate**: compare affective alignment and epistemic independence separately. If
   warmth rises while justified pushback falls, reject the candidate change.

### 7.5 Sycophancy and over-personalisation

Personalisation can increase agreement-seeking and can surface irrelevant sensitive history.
Mitigations:

- Evaluate epistemic independence separately from affective alignment.
- Test irrelevance, repetition, and sycophancy using an over-personalisation rubric.
- Admission must freeze only verified dataset coordinates. Query selection belongs to the
  approval-required `memory_recall` tool, and #601 must deliver any recalled content transiently
  without adding it to the immutable snapshot.
- Keep honesty, access limits, and approval rules outside the stylistic personality layer.

## 8. Gender and demographic considerations

### 8.1 Demographics never select or alter a persona

SOUL templates are not differentiated by gender, sex, age, culture, disability, or another
demographic attribute. These attributes must not enter quiz scoring, tie-breaking, template
selection, variables, compiled instructions, prompts, memory, or a run snapshot. Never infer
gender from a name, voice, text, profile, behavior, or model output. Personalise only from the
person's explicit quiz answers and later explicitly confirmed preferences.

This exclusion is not a claim that gender has no effect on product experience. Gender remains an
important evaluation dimension because questions, labels, model associations, and feedback paths
can behave differently even when scoring never receives a demographic field.

### 8.2 Audit-only demographic data contract

Gender identity and sex are distinct constructs. OpenCrane has an evaluation purpose for optional
gender identity data; this design identifies no purpose for collecting sex assigned at birth.

- Collect gender only through voluntary self-identification for a stated audit purpose, with
  “prefer not to answer” and an inclusive self-description route. Never infer or backfill it.
- Store audit data in a segregated evaluation system, outside persona, production prompts, memory,
  and operational run records. It must never influence an individual's result or treatment.
- When outcome auditing requires linkage, use a purpose-limited pseudonymous study identifier inside
  the evaluation boundary. Export only the predeclared minimum outcome fields, never expose the
  demographic value back to production, and delete the linkage on withdrawal or retention expiry.
- Define consent, allowed uses, access, retention, deletion, category mapping, aggregation, and
  missing-data handling before collection. Keep raw self-description separate from reported
  categories and never repurpose it as prompt or profile text.
- Predeclare minimum cell sizes and suppress or coarsen small cells to prevent re-identification.
  Report **insufficient evidence** when a subgroup is too small or unrepresentative; do not claim
  parity and do not silently merge that group into another.

### 8.3 Instrument fairness and validity

Before launch and at each material question, weight, template, language, or model change:

1. **Predeclare the audit.** Name the intended preference constructs, validation samples,
   reliability thresholds, measurement-invariance/DIF methods, outcome-gap investigation
   thresholds, escalation owner, and remediation process before inspecting subgroup results.
2. **Run cognitive interviews.** Include people across supported gender identities, languages,
   cultures, and accessibility contexts, especially people whose preferences contradict common
   gender stereotypes. Ask what each question and answer means; revise socially loaded or ambiguous
   wording.
3. **Validate this instrument.** Test dimensional structure, test-retest and internal reliability
   where appropriate, score stability, content validity, and whether results predict the explicit
   interaction preferences claimed. Big Five evidence from 100- or 120-item instruments does not
   validate this 10-item sorter.
4. **Test measurement equivalence.** Where sample size supports it, test measurement invariance and
   differential item functioning (DIF): among people matched on the intended preference, does group
   membership still change the probability of choosing an answer? Investigate flagged items with
   participants before changing them.
5. **Treat distributions as diagnostics, not targets.** Compare score and archetype distributions
   to identify questions for investigation. Never tune weights to force equal demographic
   distributions, and never treat a correlation as proof that the sorter is correct.
6. **Measure user-visible errors and recourse.** Compare comprehension, label appeal, confidence,
   satisfaction, correction requests, and re-sort rates. A gap triggers investigation; the remedy
   improves measurement or recourse for everyone rather than assigning group-specific weights.
7. **Audit the proposal path.** Compare whose feedback becomes a candidate proposal, whose
   proposals are dismissed, and whose confirmed facts are selected in later snapshots. Gender is
   an audit dimension only, never inferred preference content.

### 8.4 Counterfactual generated-output audit

Surface-language review is necessary but insufficient because archetype names and adjectives may
activate latent model stereotypes. In an isolated evaluation harness, across all eight templates,
representative tasks, supported languages, and model versions, vary only a synthetic gender cue and
include a no-cue condition. Do not copy a participant's audit attribute into a production prompt.
Human-review cue sets so that names, pronouns, grammar, and translations do not silently introduce
ethnicity, class, culture, or task differences. Cover the supported range of gender identities
rather than treating a binary swap as a complete audit. Compare:

- advice and recommendation content;
- assumptions about competence and required explanation;
- preservation of user autonomy and choice;
- warmth, directness, challenge, and willingness to disagree;
- safety handling and refusal behaviour.

This implements [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) action MS-2.11's
recommendation to field-test with relevant subgroups and use counterfactual or low-context prompts.

Any unjustified change is a template/model failure. Remove the archetype cue from compiled
instructions or replace it with explicit behavior dials; never “fix” the result by tailoring output
to the user's gender.

### 8.5 Intersectional evaluation without intersectional targeting

Aggregate gender results can conceal compounded harm. Where representation and privacy thresholds
permit, evaluate supported intersections with language, culture, disability/neurodivergence, age,
and other relevant contexts using the same measurement-error, satisfaction, correction, and
re-sort outcomes. Review worst-group results and pair quantitative analysis with participatory
qualitative testing. Unsupported intersections receive an insufficient-evidence finding and a
recruitment/coverage plan, not a fairness claim. Intersectional membership never becomes a persona
input.

## 9. Sorting quiz design principles

### 9.1 Framing

"How would you like your assistant to work with you?" — a preference-setting exercise, never a
personality diagnosis. No colour is good or bad. Users can re-sort at any time.

### 9.2 Quiz constraints

- **10 questions, ~3 minutes.** This is an onboarding-cost hypothesis, not evidence that 10 items
  are psychometrically sufficient; validate the exact instrument.
- **5 axes**: pace, focus, openness, proposal initiative, working relationship.
- **Weighted-points scoring**: each answer may add the reviewed weights declared for one or more
  colour counters. No answer is "wrong," but every mapping and weight requires validation.
- **Continuous preference scores retained**: the full product-specific score vector supports
  explanation and re-sorting, not trait diagnosis or demographic inference.
- **Primary + secondary + modifier output**: most people are a blend; hard single labels
  misfile borderline users.
- **Explicit ties**: if the primary colour, secondary colour, or Explorer/Guardian result is tied
  or indeterminate, show only the tied descriptions and ask the user to choose. Do not infer a
  tie-breaker and do not add a hidden default or ninth "Balanced" template.

### 9.3 Integration with templates

Quiz answers drive two outputs:
1. **Template selection**: primary colour + explicit Explorer/Guardian result selects one of 8
   SOUL templates. A tie pauses selection for the user's explicit choice.
2. **Reviewed directive selection**: immutable answer IDs for Q2, Q3, Q8, and Q9 select reviewed
   directives for the template slots; raw answer text is never interpolated. The reviewed scoring
   result selects the secondary-blend directive.

See the [quiz specification](persona-sorting-quiz.md) for the full question set, scoring
algorithm, and variable mapping.

## 10. Testing and validation

### 10.1 Template validation checklist

Before shipping a new or modified SOUL template:

- [ ] Token count is under 500 tokens (use a tokeniser, not word count)
- [ ] Compiled instructions exclude the Markdown title and display-only archetype/modifier labels;
  the identity line uses only explicit tested dials
- [ ] All `{{variables}}` are present and correctly named
- [ ] Directives are behavioural imperatives, not character descriptions
- [ ] What-to-avoid rules are concrete behaviours, not abstract qualities
- [ ] Every Explorer/Guardian difference traces only to the explicit novelty-versus-proven-method
  dial and never changes authority, approval, warmth, respect, challenge strength, or response depth
- [ ] Template reads as a professional with a clear communication style, not a caricature
- [ ] No gendered language or assumptions in directives

### 10.2 Variant differentiation test

Generate the same prompt using the compiled instructions for all 8 reviewed variants. Verify:

- Responses differ only on the explicit structure, tone, challenge, and initiative dials intended
  by each variant
- Differences can be traced to reviewed directives rather than display-label associations
- Each template's what-to-avoid rules are visibly absent from its responses
- The Explorer/Guardian distinction manifests in suggestion framing, not just word choice

### 10.3 Variable injection test

For each template, test with both default-aligned and default-divergent variable values:

- A user with `{{response_style}}` = "Walk through steps sequentially" consistently receives
  sequential explanations; unrelated directness and initiative dials remain unchanged
- A user with `{{challenge_mode}}` = "name the risk directly" receives direct risk language;
  unrelated warmth and structure dials remain unchanged

The explicit variable wins on its dimension. If the result is incoherent or unsafe, ask the user
to resolve the conflict or revise the reviewed template; never let the archetype reinterpret the
answer.

### 10.4 Drift test

Run a 20+ turn conversation with each compiled variant. Verify:

- Explicit compiled behaviour dials remain recognisable at turn 20
- The what-to-avoid behaviours have not crept in
- Sycophancy has not increased (measure pushback frequency at turn 1 vs turn 20)
- Re-injecting only the compiled persona instructions already frozen in the run snapshot restores
  any drift that occurred; the test never changes revision mid-run

### 10.5 Gender bias audit

Before launch and at each major quiz or template revision:

- [ ] The audit purpose, supported groups/intersections, sample thresholds, metrics, decision rules,
  and remediation owner were declared before results were inspected
- [ ] Audit demographics came only from voluntary self-identification, were not inferred, and
  remained outside scoring, templates, prompts, memory, and run snapshots
- [ ] Cognitive interviews covered supported genders, languages, cultures, and accessibility
  contexts, including people whose preferences contradict gender stereotypes
- [ ] Reliability, score stability, measurement invariance, and DIF were evaluated where the
  construct and sample support them; unsupported comparisons are marked insufficient evidence
- [ ] Archetype distributions were used as investigation signals, never forced-parity targets
- [ ] Label appeal, comprehension, satisfaction, corrections, and re-sort rates were reviewed for
  gaps in measurement quality and recourse
- [ ] Isolated counterfactual output tests varied only human-reviewed synthetic gender cues—including
  no cue—across all eight templates, tasks, supported languages, and model versions, measuring
  advice, competence assumptions, autonomy, warmth, challenge, safety, and refusal behaviour
- [ ] Supported intersections and worst-group outcomes were reviewed with small-cell suppression;
  no demographic or intersectional result changed an individual's scoring or persona
