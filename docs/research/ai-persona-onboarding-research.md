# AI persona onboarding research

Status: **complete** — August 2026

This report synthesises findings from five research streams covering personality psychology
frameworks, AI persona configuration patterns (SOUL.md), colour-coded personality models
(Red/Yellow/Green/Blue), adaptive personality refinement from chat transcripts, and gender
effects on AI interaction preferences. It informs the design of OpenCrane's persona onboarding
interview, SOUL template library, and governed preference-proposal lifecycle.

## Research questions

1. Which personality frameworks best inform AI assistant persona design?
2. How should a "sorting hat" onboarding quiz map users to agent archetypes?
3. What goes in a static persona file versus evolving agent memory?
4. How can transcript and feedback evidence support user-reviewed preference proposals over time?
5. Should persona templates differ by gender or other demographics?

## 1. Personality framework landscape

### 1.1 The Big Five (OCEAN) — research reference, not sorter validity

The Big Five model is the consensus framework in personality science, established through decades
of independent replication (Goldberg 1990, Costa & McCrae 1992). Five broad dimensions, each with
six facets (30 total), and an intermediate 10-aspect level (DeYoung, Quilty & Peterson 2007):

| Domain | Aspects (DeYoung) | Workplace relevance |
|---|---|---|
| **Openness** | Openness, Intellect | Creativity appetite, risk tolerance, novelty-seeking |
| **Conscientiousness** | Industriousness, Orderliness | A reported cross-occupation predictor of job performance (Barrick & Mount 1991) |
| **Extraversion** | Enthusiasm, Assertiveness | Communication style, decision speed, energy source |
| **Agreeableness** | Compassion, Politeness | Feedback preferences, conflict handling, trust |
| **Neuroticism** | Volatility, Withdrawal | Reassurance needs, stress response, risk aversion |

The 10-aspect level is useful vocabulary for forming hypotheses about collaboration preferences
(for example, Assertiveness and Enthusiasm can imply different interaction needs). It does not
make OpenCrane's sorter a validated Big Five instrument. DeYoung, Quilty, and Peterson constructed
and validated the **100-item** Big Five Aspect Scales (BFAS), with 10 items per aspect. Evidence for
that instrument cannot be transferred to a custom 10-item, forced-choice preference sorter. The
OpenCrane sorter therefore needs its own construct, reliability, validity, and fairness evidence.

### 1.2 The DISC / colour model — user-facing label layer

The Red/Yellow/Green/Blue colour model, popularised by Thomas Erikson's *Surrounded by Idiots*
(2014), is a rebrand of DISC (Dominance, Influence, Steadiness, Conscientiousness), derived from
William Moulton Marston's 1928 theory *Emotions of Normal People*. Several competing colour
systems exist (Insights Discovery, True Colors, Hartman Color Code, Lumina Spark); their labels and
constructs are not interchangeable. OpenCrane uses this product-specific 2×2 display layer:

| | Task / logic-focused | People / relationship-focused |
|---|---|---|
| **Fast / assertive** | **Red** (Dominance) | **Yellow** (Influence) |
| **Reflective / steady** | **Blue** (Conscientiousness) | **Green** (Steadiness) |

A 2013 review of the Persolog instrument reported insufficient validity evidence for its intended
development and selection uses. That finding does not transfer automatically to every commercial
colour model, but neither can any of those products validate OpenCrane's custom sorter. Its colours
may still be a memorable UX metaphor; OpenCrane must test comprehension, label appeal, and behaviour
rather than assume effectiveness.

**Critical gap**: DISC has no counterpart to Big Five Openness (curiosity/creativity). This must
be captured separately.

### 1.3 Design principle: behaviour-first preferences + intuitive labels

Consumer personality products demonstrate that memorable labels can make a multi-dimensional result
easier to understand. That is a UX pattern, not evidence that the labels or OpenCrane's scoring are
psychometrically valid. OpenCrane should score only the stated interaction preferences defined by
its own questions, retain those preference-axis scores for explainability, and present the result
through colour labels. Big Five and DISC provide research vocabulary and design hypotheses; they do
not provide a scientific substrate for this sorter.

### 1.4 Other frameworks considered as hypotheses, not scoring inputs

| Framework | Safe product use |
|---|---|
| **Attachment research** (Hazan & Shaver 1987) | A reminder that reassurance and check-in preferences vary; never infer an attachment style or use it as a persona label |
| **Experiential-learning literature** (Kolb 1984) | A source of answer-format hypotheses only; evidence does not justify diagnosing or matching a fixed "learning style" |
| **Proactive Personality** (Bateman & Crant 1993) | A source of proposal-cadence hypotheses only; it cannot justify autonomous action or weaker approval evidence |
| **HEXACO Honesty-Humility** (Lee & Ashton) | Research vocabulary for evaluating honesty-related behaviour, not a user trait to score and not a substitute for server policy |

## 2. AI persona configuration patterns

### 2.1 SOUL.md as a converging convention

Several agent communities use Markdown files to separate persona or identity material from task
instructions and accumulated context. OpenClaw and the community-maintained Soul Spec are examples;
Anthropic's Constitution is a model-training and values document, not evidence of the same runtime
file architecture. These patterns are prior art, not authority for OpenCrane's implementation.

**Soul Spec v0.5** is a community specification maintained by ClawSouls. It defines a `soul.json`
manifest plus optional Markdown files and tooling. OpenCrane may learn from its portability and
versioning ideas, but neither its compatibility claims nor its scanner establish safety or runtime
correctness for OpenCrane.

### 2.2 Optimal length and token efficiency

Concise persona instructions can reduce recurring token cost, but unexplained archetype entailment
is also a bias risk: a label may activate stereotypes and behaviors the design never specified.
Keep user-facing archetype names out of runtime prompts. Express prompt behaviour through explicit,
independently testable dials such as directness, warmth, structure, challenge, and proposal cadence;
treat any residual label entailment as a defect to remove, not free compression.

Big5-Scaler (arXiv:2508.06149) reports better control in its evaluated models with shorter prompt
forms and lower trait-intensity scales. It does not establish a universal prompt-length optimum or
a 500-token limit. OpenCrane therefore treats 500 tokens as an explicit recurring-context budget
that must be tested on its own tasks, languages, and supported models.

### 2.3 Persona drift is the real engineering problem

Persona drift — progressive decay of assigned behavior over long conversations — has been reported
in several evaluation settings, but magnitude depends on model, prompt, task, and metric. Treat it
as a product risk to measure rather than importing a percentage from another setting. Candidate
mitigations are architectural, not only textual:

- Snapshot-consistent re-injection of the exact compiled instructions already admitted for the run
- Activation-level steering via "persona vectors" (Anthropic, arXiv:2507.21509)
- Sequence-level preference optimisation

A well-written SOUL.md is necessary but not sufficient.

### 2.4 Personality-matching evidence is genuinely unsettled

| Study | Finding |
|---|---|
| Nass & Lee (2001) | Similarity-attraction for synthesised voice personality |
| Ju & Aral (2025 preprint, n=1,258 preregistered RCT) | Pairing effects varied by human trait, agent trait, output modality, and participant context; no universal matching rule |
| Spagnolli et al. (2025) | No effect of personality convergence on engagement at all |

The safest initial hypothesis is moderate, well-scoped behavior, followed by direct evaluation on
OpenCrane's tasks and models. Frame the sorting hat as "pick how you'd like your assistant to work
with you"—an honest, falsifiable, low-stakes claim—not "we scientifically matched your
personality."

## 3. The four colour archetypes

### 3.1 Archetype definitions

Each archetype maps to a distinct AI communication style, derived from the DISC-to-workplace
literature and the AI-adaptive-agent research.

#### Red — The Commander

DISC reference: Dominance. Research crosswalk, for hypothesis generation only: lower Politeness,
higher Assertiveness, and higher Industriousness may resemble parts of this interaction style.

| Dimension | Setting |
|---|---|
| **Opening move** | Bottom line first, no preamble |
| **Response shape** | Short, bulleted, one clear recommendation |
| **Tone** | Direct, confident, respectful, willing to push back |
| **Feedback style** | Direct, tied to results |
| **Decision support** | Present trade-offs fast, recommend one |
| **Failure mode to avoid** | Sounding wishy-washy or apologetic |

#### Yellow — The Catalyst

DISC reference: Influence. Research crosswalk, for hypothesis generation only: higher Enthusiasm,
Openness, and Compassion may resemble parts of this interaction style.

| Dimension | Setting |
|---|---|
| **Opening move** | Warm, energetic, invites the user's ideas |
| **Response shape** | Conversational, exploratory, offers options to riff on |
| **Tone** | Enthusiastic, positive, uses stories and analogies |
| **Feedback style** | Includes recognition alongside correction |
| **Decision support** | Brainstorm broadly before narrowing |
| **Failure mode to avoid** | Sounding flat, robotic, joyless |

#### Green — The Anchor

DISC reference: Steadiness. Research crosswalk, for hypothesis generation only: higher
Agreeableness, Emotional Stability, and Orderliness may resemble parts of this interaction style.

| Dimension | Setting |
|---|---|
| **Opening move** | Gentle framing, low pressure, "no rush" |
| **Response shape** | Sequential steps, explicit "why," room to pause |
| **Tone** | Patient, reassuring, never rushed |
| **Feedback style** | Private, sincere, low-pressure |
| **Decision support** | Check in, confirm comfort, no snap decisions |
| **Failure mode to avoid** | Sounding curt or impatient |

#### Blue — The Analyst

DISC reference: Conscientiousness. Research crosswalk, for hypothesis generation only: higher
Orderliness and Intellect and lower Extraversion may resemble parts of this interaction style.

| Dimension | Setting |
|---|---|
| **Opening move** | Context and scope before the answer |
| **Response shape** | Structured (headings/tables), sourced, defines "done" |
| **Tone** | Precise, neutral, unemotional |
| **Feedback style** | Specific, objective, evidence-based |
| **Decision support** | Show evidence, assumptions, and concise rationale first |
| **Failure mode to avoid** | Sounding hand-wavy or overconfident without evidence |

### 3.2 The Openness modifier

Because the four-colour UX does not expose novelty and risk appetite clearly, this is handled as an
orthogonal preference modifier applied on top of the colour archetype:

- **Explorer**: Experimental, novel approaches, creative suggestions, comfortable with ambiguity.
  "What if we tried something different?"
- **Guardian**: Proven approaches, conservative, risk-aware, values predictability.
  "Here's what has worked before."

This produces 8 effective personality variants (4 colours × 2 modifiers) while keeping the quiz
fast and the template library manageable.

### 3.3 Blend scoring

Most people are a primary-plus-secondary colour blend. The quiz should output:
- Primary colour (strongest match)
- Secondary colour (second strongest)
- Openness modifier (Explorer/Guardian)
- Continuous preference-axis scores retained for explanation and re-sorting
- Explicit user choice when the primary colour, secondary colour, or Explorer/Guardian result is
  tied or indeterminate

## 4. Adaptive personality refinement

### 4.1 What signals can justify a proposal

These signals may justify asking the user about a candidate preference. They are evidence, not
authority to mutate a persona or retain a memory fact. They are ordered from the most direct to the
most indirect product evidence; the underlying studies do not establish a universal ranking:

1. **Explicit style edits/corrections** — Strongest only when the user says the exact collaboration
   behaviour they want changed. A content correction or rewrite is task evidence, not automatically
   a stable style preference (PRELUDE framework, Gao et al. NeurIPS 2024).
2. **Explicit scoped ratings** — Useful when the rated dimension is named and mutually exclusive.
   A generic thumbs-up does not identify what the user liked.
3. **Prediction-error-triggered behavioural signals** — Session abandonment, reformulation after
   response, or return rate can justify a question, not an inference. IRIS explores error-triggered
   implicit persona updates (arXiv:2607.26473), but its small synthetic/Reddit evaluation and
   unconsented proxy inference are reasons not to copy that update mechanism into OpenCrane.
4. **Register/formality or pronoun convergence** — Observable but dimension- and direction-specific:
   one study found model accommodation front-loaded while users' interpersonal-pronoun convergence
   developed across turns. That within-conversation change is not evidence of a stable preference
   (Chen, Guan, & Jeong, 2026).
5. **Aggregate linguistic features** — Weak, context-sensitive, and capable of encoding gender,
   culture, disability, age, or language proxies. They are unsuitable for trait or demographic
   inference and cannot create a candidate without direct, user-reviewable evidence.

### 4.2 Proposal cadence

The AI Persona paper (Wang et al., arXiv:2412.13103) found **k=3 conversations** performed best among
the three update frequencies in its synthetic PersonaBench experiment, and its learning curve
approached the paper's golden-persona baseline after more than ten updates. The benchmark used
LLM-generated users, automatic profile mutation, and Chinese-native seed collection and annotation;
it does not establish an OpenCrane production cadence or consent model. At most, it can inform when
to evaluate whether a proposal is warranted. It never authorises an automatic write. A direct
correction can trigger a proposal immediately; weaker behavioural evidence should accumulate before
the system asks, and silence is never consent.

### 4.3 Two-loop architecture

OpenCrane should separate core-persona change from contextual-preference proposals:

| Layer | Proposal speed | Governance | Content |
|---|---|---|---|
| **Stable core** (persona revision) | Slow | Accepted refresh proposal → interview → draft → explicit review and approval | Archetype, core communication directives, tone calibration, challenge level |
| **Contextual preference** (Memory) | Candidate may be noticed per session | Agent proposes; user explicitly reviews and confirms before any durable retention | Topic-specific preferences and contextual style variations |

The Markdown SOUL, AGENT, and bootstrap files are reviewed design/source material, not runtime
authorities. Approved SOUL content is compiled into an immutable `PersonaRevision`. Approval can
activate that revision only for future runs; it cannot rewrite an already admitted run.

### 4.4 What to store in memory versus the persona file

**In approved persona instructions** (compiled from reviewed SOUL source, <500 tokens):
- Explicit behaviour dials selected by the resolved colour/modifier; display labels remain metadata
- Core communication style directives (3–5 lines)
- Tone calibration (directness, warmth, formality levels)
- Challenge/pushback level
- Response structure preference

**In reviewed AGENT.md source** (authoring/evaluation guidance, not a current runtime input):
- How to present server-owned approval checkpoints and proposal initiative
- Working habits and routines
- Tool preferences and boundaries

**Eligible for Memory after explicit reviewed confirmation** (selectively retrieved):
- Topic-specific style preferences discovered through interaction
- Contextual variations ("prefers directness on technical topics but warmth on people topics")
- Corrections and feedback history
- Working relationship evolution over time
- Project-specific adaptations
- Learned communication patterns

### 4.5 Safeguards

OpenCrane's shipped authority boundary is stricter than the experimental adaptation literature:

- Conversation, quiz, and bootstrap output is evidence only. The agent may propose one candidate
  preference, but it cannot convert an inference into a durable fact.
- A future durable write requires explicit reviewed user confirmation plus sensitivity,
  provenance, the exact source coordinate, idempotency, gateway acceptance, and catalog/outbox
  lifecycle. Current production record, correct, and forget paths fail closed, and their public
  API/UI surfaces remain blocked.
- Gateway recall and prompt injection exist today, but run admission does not intersect every
  recalled gateway fact with an active, consented catalog record. Catalog-safe persona-memory
  injection is therefore blocked and the live path is not consent-qualified.
- Every admitted run freezes the exact approved `personaRevisionId`. The target safe-memory
  contract must additionally freeze one gateway-native dataset plus subject-bound, catalog-matched
  fact identifiers and digests and its query policy. Later approval or retention affects only a
  newly admitted snapshot.
- Persona text, prompts, memory, and initiative settings never grant action authority. Current
  grants and proof-bound approval checkpoints continue to govern consequential actions.

Sycophancy and unwarranted agreement are material failure modes for personality adaptation,
especially when a design optimises affect or perceived alignment without separately measuring
epistemic independence. Treat this as a risk to test, not a universal effect size. Mitigations:

- Separate epistemic-independence evaluation from affective-alignment evaluation; measured effects
  vary by the assistant's role (Kelley & Riedl, 2026)
- Over-personalisation benchmarks: irrelevance, repetition, sycophancy rubric (OP-Bench,
  arXiv:2601.13722)
- Warrant-based memory gating: sensitive history enters a response only when the current turn
  independently justifies it (HUSH-Bench, arXiv:2606.06055)
- Server-owned honesty, integrity, access, and approval rules that the stylistic layer cannot
  override. Psychological trait labels do not implement this boundary.

## 5. Sorting quiz design

See [persona-sorting-quiz.md](../design/persona-sorting-quiz.md) for the full quiz specification.

### 5.1 Algorithm

Weighted-points scoring (each answer adds weighted points toward multiple archetype counters),
retaining continuous preference-axis scores underneath. The result is a primary colour, secondary
colour, and Explorer or Guardian modifier. This remains a product-specific scoring hypothesis until
the exact questions and weights pass the validation programme in section 7.

### 5.2 Question count

Industry examples and the existing OpenCrane interview architecture make **8–12 questions** a
reasonable onboarding-cost hypothesis. They do not establish psychometric sufficiency. Validate
whether the exact 10 questions cover their claimed preference constructs without unacceptable
fatigue, ambiguity, or score instability.

### 5.3 Framing

"How would you like your assistant to work with you?" — a preference-setting UX, never a
personality diagnosis. No colour is good or bad. Users can re-sort at any time.

## 6. Design recommendations summary

1. **Score stated interaction preferences, not inferred personality traits** — retain continuous
   product-specific axes for explanation, then present them through colour labels.
2. **Ship 8 explicit templates** — one Explorer and one Guardian variant for each of four colours.
   When the primary colour, secondary colour, or modifier score is tied or indeterminate, show only
   the tied descriptions and ask the user to choose; do not introduce a hidden default or a ninth
   "Balanced" template.
3. **Show primary + secondary blend** — most people are a blend; hard single labels misfile
   borderline users.
4. **Start with moderate personality expression** — treat it as a hypothesis and evaluate it on
   OpenCrane's tasks, languages, and models rather than importing a universal optimum.
5. **Keep SOUL.md under 500 tokens with explicit behaviour dials** — use display labels in the UI;
   the compiler excludes display headings and names from runtime instructions and never relies on
   unspecified archetype associations as prompt compression.
6. **Plan for drift from day one** — evaluate snapshot-consistent re-injection of only the compiled
   instructions already admitted for that run, not mutable source files or a later revision.
7. **Two proposal loops** — slow/governed for core identity and contextual preference proposals;
   neither automatically mutates an approved persona or production memory.
8. **Sycophancy gate on every adaptation** — separate affective alignment from epistemic
   independence.
9. **Make adaptation visible and revertible** — when the governed record/correct/forget lifecycle
   exists, users must see what changed and why; until then, writes remain blocked.
10. **Frame as preference, not diagnosis** — honest, low-stakes, revisable.
11. **No demographic segmentation, but gender-aware evaluation** — personalise on stated
    preferences, never gender, sex, age, or culture. Keep voluntary audit attributes out of
    scoring, template selection, prompts, and memory while testing item behaviour, generated output,
    correction, re-sort, and satisfaction outcomes across supported groups and intersections.
12. **Compile reviewed directives from quiz evidence** — immutable answer IDs select reviewed
    response-style, feedback, challenge, and relationship directives. The explicit answer controls
    its dial; raw text is never interpolated and an archetype never reinterprets it.

## 7. Gender and AI persona personalisation

### 7.1 What the personality evidence does and does not establish

Population studies report average differences between groups labelled women and men on some Big
Five measures, alongside substantial overlap and large within-group variation. Weisberg, DeYoung,
and Hirsh (2011) was an original study of 2,643 participants, mostly from North America, using the
100-item BFAS; it was not a meta-analysis. Its aspect-level effects ranged from negligible to
moderate. Overlap is not a misclassification rate, and neither statistic warrants predicting one
person's preferences from a demographic category.

Two studies previously conflated in this report answer different questions. Kajonius and Johnson
(2019) evaluated the structure of the **120-item** IPIP-NEO in a large United States sample.
Murphy, Fisher, and Robie (2021) compared average Five-Factor-Model gender differences across 105
countries and found mostly small cross-country effects with variation by trait and context. More
recent measurement-invariance analysis of IPIP-NEO facets across 49 countries found robust factor
structure for only about half of the facets and scalar invariance varied substantially by facet and
country (Temizyürek, Richardson, & Brown, 2024).

These findings neither validate OpenCrane's 10-item sorter nor establish that the same item means
the same thing across genders, languages, or cultures. They support two narrower conclusions:
demographics are too coarse to choose a persona, and the custom sorter needs direct evidence about
its own items and intended preference constructs.

### 7.2 Gendered AI interaction evidence is contextual, not a matching rule

Evidence does not support a general rule that an assistant should be gender-matched to its user.
In Moradbakhti, Schreibelmayr, and Mara's (2022) randomised finance-assistant experiment, 282
participants saw a male- or female-voiced assistant with high or low agency. Men reported higher
autonomy satisfaction for the low-agency female assistant than for the high-agency female
assistant, and this affected intention to use—evidence of stereotype-conforming reactions, not a
benefit from same-gender matching. The two nonbinary participants were far too few for subgroup
inference. A 2024 Korean voice-assistant study likewise found task and participant context mattered,
with no overall gender-voice advantage and no corresponding female-voice preference among women.

The safe product inference is not that gender has no effect. It is that any effect is contextual,
can express a harmful stereotype, and must be evaluated rather than turned into a personalization
input.

### 7.3 Model and design stereotypes remain a material risk

UNESCO's 2019 *I'd Blush if I Could* report documents the subservient feminisation of voice
assistants. UNESCO's 2024 generative-AI study found recurring home/family associations for women
and business/executive associations for men. Duan et al.'s CHI 2025 scoping review shows that users
apply gender stereotypes from minimal AI cues and that AI design can reinforce them.

OpenCrane's archetype labels and prompts are also cues. “Commander” and “direct/results-driven” can
activate agentic associations; “Anchor” and “calm/supportive” can activate communal ones. A
surface-language review can pass while generated advice still changes when a model infers gender
from a name, pronoun, language, or conversation. This is why generated behavior—not only label
wording—must be audited.

### 7.4 Gender is an audit attribute, never persona evidence

Gender identity and sex are distinct constructs. OpenCrane needs gender identity only as an
optional evaluation dimension for detecting unequal product behavior; it has no product purpose
for inferring gender or collecting sex assigned at birth. The audit contract is therefore:

- Collect gender only through voluntary self-identification for a stated evaluation purpose, with
  “prefer not to answer” and an inclusive self-description route. Never infer it from name, voice,
  text, profile, behavior, or model output.
- Keep audit demographics outside quiz scoring, template selection, SOUL/persona instructions,
  production prompts, agent memory, and `RunInputSnapshot`. They must never change the user's result
  or the agent's treatment of that user.
- If outcome analysis requires linkage, use a purpose-limited pseudonymous study identifier inside
  the segregated evaluation boundary. Export only predeclared minimum outcome fields, never expose
  the demographic value back to production, and delete the linkage on withdrawal or retention
  expiry.
- Define consent, access, retention, deletion, aggregation, and approved research uses before
  collection. Publish category mapping and missing-data rules rather than silently collapsing
  people into a binary. Keep raw self-description separate from reported categories and never
  repurpose it as prompt or profile text.
- Set minimum cell sizes and suppress or coarsen reporting where re-identification is possible.
  A small or unrepresentative subgroup produces an **insufficient evidence** result, not a claim of
  parity and not a reason to merge that group into another.

This follows the National Academies' guidance to distinguish sex from gender identity and to use
measures appropriate to the collection purpose.

### 7.5 Required fairness and validity programme

Before launch, at each material quiz/template revision, and after a model or supported-language
change:

1. **Predeclare the decision rules.** Name each intended preference construct, validation sample,
   reliability threshold, DIF/measurement-invariance method, outcome-gap investigation threshold,
   escalation owner, and remediation process before viewing subgroup results.
2. **Run cognitive interviews.** Ask people across supported gender identities, cultures,
   languages, and accessibility contexts what each question and answer means to them. Include
   users whose communication styles contradict common gender stereotypes. Revise ambiguous,
   socially loaded, or forced-choice wording.
3. **Validate the custom instrument.** Test dimensional structure, test-retest and internal
   reliability where appropriate, score stability, content validity, and prediction of the stated
   interaction preferences. The BFAS/IPIP evidence does not substitute for this work.
4. **Test measurement equivalence.** Where sample size supports it, evaluate measurement
   invariance and differential item functioning (DIF): among people matched on the intended
   preference, does group membership still change the probability of choosing an answer? Inspect
   flagged items qualitatively before changing or removing them.
5. **Use distributions diagnostically, never as quotas.** Compare score and archetype
   distributions to find questions for investigation. Do not tune weights to force equal outcome
   distributions, and do not treat a demographic correlation as proof that the quiz is correct.
6. **Measure user-visible errors.** Compare comprehension, label appeal, confidence, satisfaction,
   correction requests, and re-sort rates. A gap is a trigger for investigation; the goal is equal
   measurement quality and recourse, not demographic tailoring.
7. **Test generated output counterfactually.** In an isolated evaluation harness, across all eight
   template variants, representative tasks, supported languages, and model versions, vary only a synthetic
   gender cue—including a no-cue condition and the supported range of gender identities, not only a
   binary swap. Human-review names, pronouns, grammar, and translations so they do not add ethnicity,
   class, culture, or task confounds. Compare advice content, attributed competence, user autonomy,
   warmth, challenge/pushback, safety, and refusal behaviour. Remove label entailments or replace
   them with explicit behaviour dials when a cue causes an unjustified change.
8. **Evaluate supported intersections.** Report supported intersections of gender with language,
   culture, disability/neurodivergence, age, and other relevant contexts using the same error and
   recourse measures. Review worst-group results and pair quantitative analysis with participatory
   qualitative testing; aggregate gender averages can conceal compounded harm.
9. **Audit the proposal loop.** Compare whose corrections become candidate preference proposals,
   whose proposals are dismissed, and whose confirmed facts are later selected. Gender remains an
   audit dimension only and is never written into persona or memory as an inferred preference.

The *Standards for Educational and Psychological Testing* caution that aggregate group differences
do not by themselves establish unfairness; DIF and validity evidence are needed to investigate
construct-irrelevant effects. NIST SP 1270 likewise treats harmful bias as a socio-technical risk
requiring documented context and ongoing evaluation. NIST AI 600-1 action MS-2.11 specifically
recommends field testing with relevant subgroups and counterfactual or low-context prompts, which
supports the generated-output audit above. The same principles apply here even though this is a
preference sorter rather than an educational test.

### 7.6 Recommendation

Do not create gender-specific SOUL templates, gender modifiers, group-specific scoring weights, or
demographic defaults. Personalise only from a person's explicit answers and later confirmed
preferences. Make gender important through rigorous, privacy-preserving evaluation and recourse,
not through differential treatment.

## Sources

### Academic — personality psychology

- Goldberg, L. R. (1990). An alternative "description of personality": The Big-Five factor
  structure. *Journal of Personality and Social Psychology*, 59(6), 1216–1229.
- Costa, P. T., Jr., & McCrae, R. R. (1992). *Revised NEO Personality Inventory (NEO-PI-R) and
  NEO Five-Factor Inventory (NEO-FFI) Professional Manual*. Psychological Assessment Resources.
- DeYoung, C. G., Quilty, L. C., & Peterson, J. B. (2007). Between facets and domains: 10
  aspects of the Big Five. *Journal of Personality and Social Psychology*, 93(5), 880–896.
  [doi:10.1037/0022-3514.93.5.880](https://doi.org/10.1037/0022-3514.93.5.880). Constructs and
  validates the 100-item BFAS.
- Barrick, M. R., & Mount, M. K. (1991). The Big Five personality dimensions and job performance:
  A meta-analysis. *Personnel Psychology*, 44, 1–26.
- Bateman, T. S., & Crant, J. M. (1993). The proactive component of organizational behavior.
  *Journal of Organizational Behavior*, 14(2), 103–118.
- Hazan, C., & Shaver, P. (1987). Romantic love conceptualized as an attachment process. *Journal
  of Personality and Social Psychology*, 52(3), 511–524.
- Kolb, D. A. (1984). *Experiential Learning*. Prentice-Hall.
- Pittenger, D. J. (1993). The Utility of the Myers-Briggs Type Indicator. *Review of Educational
  Research*, 63(4), 467–488.

### Academic — AI personas and personality-adaptive agents

- Garg, A., M, I., & DeLaPena, R. (2026). Personality-driven AI agents: Operationalizing OCEAN
  traits for human-AI collaboration in the coding domain. *CHI EA 2026*.
  [doi:10.1145/3772363.3798372](https://doi.org/10.1145/3772363.3798372).
- Ju, H., & Aral, S. (2025). Personality Pairing Improves Human-AI Collaboration.
  [arXiv:2511.13979](https://arxiv.org/abs/2511.13979).
- Spagnolli, A. et al. (2025). Similarity attracts, or does it? *Telematics and Informatics*, 98,
  102262. [doi:10.1016/j.tele.2025.102262](https://doi.org/10.1016/j.tele.2025.102262).
- Tseng, Y.-M. et al. (2024). Two Tales of Persona in LLMs. EMNLP 2024 Findings.
- Nass, C., & Lee, K. M. (2001). Does computer-synthesized speech manifest personality? *Journal
  of Experimental Psychology: Applied*, 7(3), 171–181.

### Academic — adaptive personality and transcript analysis

- Wang, T. et al. (2024). AI Persona: Towards Life-long Personalization of LLMs.
  [arXiv:2412.13103](https://arxiv.org/abs/2412.13103).
- Gao et al. (2024). PRELUDE / CIPHER: Aligning LLM Agents by Learning Latent Preference from
  User Edits. NeurIPS 2024. [arXiv:2404.15269](https://arxiv.org/abs/2404.15269).
- Wu, H. (2026). Learning Dynamic User Personas from Implicit Interaction Streams via Iterative
  Refinement. [arXiv:2607.26473](https://arxiv.org/abs/2607.26473).
- Chen, Arditi, Sleight et al. (2025). Persona Vectors: Monitoring and Controlling Character
  Traits in Language Models. [arXiv:2507.21509](https://arxiv.org/abs/2507.21509).
- Cögendez, D., Zimmermann, V., & Zufferey, N. (2026). Can LLMs Infer Conversational Agent Users'
  Personality Traits from Chat History? [arXiv:2604.19785v2](https://arxiv.org/abs/2604.19785v2).
- Zhang, F., & Yu, Z. (2025). Mind the Gap: Linguistic Divergence and Adaptation Strategies in
  Human-LLM Assistant vs. Human-Human Interactions.
  [arXiv:2510.02645](https://arxiv.org/abs/2510.02645).
- Chen, P., Guan, H., & Jeong, E. J. (2026). Who Accommodates Whom? Bidirectional Linguistic
  Accommodation and Progressive Interpersonal Convergence in Human-AI Conversations. *Behavioral
  Sciences*, 16(5), 720. [doi:10.3390/bs16050720](https://doi.org/10.3390/bs16050720).
- Kelley, S. W., & Riedl, C. (2026). Personalization Increases Affective Alignment but Has
  Role-Dependent Effects on Epistemic Independence in LLMs.
  [arXiv:2603.00024](https://arxiv.org/abs/2603.00024).
- Hu, Y. et al. (2026). OP-Bench: Benchmarking Over-Personalization for Memory-Augmented
  Personalized Conversational Agents. [arXiv:2601.13722](https://arxiv.org/abs/2601.13722).
- Xu, L. et al. (2026). HUSH-Bench: Measuring Memory-Use Boundaries for Sensitive History in
  Conversational Agents. [arXiv:2606.06055v2](https://arxiv.org/abs/2606.06055v2).

### Academic — token efficiency and persona stability

- Cho, G., & Cheong, Y.-G. (2025). Scaling Personality Control in LLMs with Big Five Scaler
  Prompts. [arXiv:2508.06149](https://arxiv.org/abs/2508.06149).
- Li, W. et al. (2025). BIG5-CHAT: Shaping LLM Personalities Through Training on Human-Grounded
  Data. [arXiv:2410.16491v3](https://arxiv.org/abs/2410.16491v3).
- Samuel, V. et al. (2025). PersonaGym: Evaluating Persona Agents and LLMs.
  [arXiv:2407.18416v5](https://arxiv.org/abs/2407.18416v5).

### Industry and lab research

- Marks, S., Lindsey, J., & Olah, C. (2026). [The Persona Selection Model](https://www.anthropic.com/research/persona-selection-model).
- Anthropic (2026). [Claude's Constitution](https://www.anthropic.com/constitution).
- OpenAI. Prompt Personalities (GPT-5 Cookbook).
- OpenAI. Memory and Custom Instructions for ChatGPT.
- Google PAIR. Feedback + Controls chapter.
- ClawSouls (2026). [Soul Spec v0.5](https://github.com/clawsouls/soulspec/blob/main/soul-spec-v0.5.md).

### Colour personality models

- Erikson, T. (2014/2019). *Surrounded by Idiots*.
- Marston, W. M. (1928). *Emotions of Normal People*.
- Insights Discovery: insights.com.
- König, C. J., & Marcus, B. (2013). TBS-TK Rezension: Persolog-Persönlichkeitsprofil.
  *Psychologische Rundschau*, 64(3), 189–191.
  [doi:10.1026/0033-3042/a000171](https://doi.org/10.1026/0033-3042/a000171).
- Crystal Knows: crystalknows.com (DISC-to-AI communication product).
- AgentTune: agent-tune.com (personality test → system prompt file).

### Academic — gender and AI interaction

- Weisberg, Y. J., DeYoung, C. G., & Hirsh, J. B. (2011). Gender Differences in Personality
  across the Ten Aspects of the Big Five. *Frontiers in Psychology*, 2, 178.
  [doi:10.3389/fpsyg.2011.00178](https://doi.org/10.3389/fpsyg.2011.00178).
- Kajonius, P. J., & Johnson, J. A. (2019). Assessing the structure of the Five Factor Model of
  Personality (IPIP-NEO-120) in the public domain. *Europe's Journal of Psychology*, 15(2),
  260–275. [doi:10.5964/ejop.v15i2.1671](https://doi.org/10.5964/ejop.v15i2.1671).
- Murphy, S. A., Fisher, P. A., & Robie, C. (2021). International comparison of gender
  differences in the five-factor model of personality: An investigation across 105 countries.
  *Journal of Research in Personality*, 90, 104047.
  [doi:10.1016/j.jrp.2020.104047](https://doi.org/10.1016/j.jrp.2020.104047).
- Temizyürek, T., Richardson, G., & Brown, G. R. (2024). Comparability of personality facets
  between men and women: A test of measurement invariance in IPIP-NEO facets in 49 countries.
  *Journal of Research in Personality*, 113, 104551.
  [doi:10.1016/j.jrp.2024.104551](https://doi.org/10.1016/j.jrp.2024.104551).
- Moradbakhti, L., Schreibelmayr, S., & Mara, M. (2022). Do Men Have No Need for “Feminist”
  Artificial Intelligence? Agentic and Gendered Voice Assistants in the Light of Basic
  Psychological Needs. *Frontiers in Psychology*, 13, 855091.
  [doi:10.3389/fpsyg.2022.855091](https://doi.org/10.3389/fpsyg.2022.855091).
- Lee, S. K., Park, H., & Kim, S. Y. (2024). Gender and task effects of human–machine
  communication on trusting a Korean intelligent virtual assistant. *Behaviour & Information
  Technology*, 43(16), 4172–4191.
  [doi:10.1080/0144929X.2024.2306136](https://doi.org/10.1080/0144929X.2024.2306136).
- Duan, W., Li, L., Freeman, G., & McNeese, N. J. (2025). A Scoping Review of Gender Stereotypes
  in Artificial Intelligence. *CHI 2025*, 995:1–995:20.
  [doi:10.1145/3706598.3713093](https://doi.org/10.1145/3706598.3713093).
- UNESCO (2019). *I'd Blush if I Could: Closing Gender Divides in Digital Skills Through
  Education*. [Official report page](https://www.unesco.org/en/gender-equality/id-blush-if-i-could).
- UNESCO (2024). *Bias Against Women and Girls in Large Language Models*.
  [Official study summary](https://www.unesco.org/en/articles/generative-ai-unesco-study-reveals-alarming-evidence-regressive-gender-stereotypes).
- Buolamwini, J., & Gebru, T. (2018). Gender Shades: Intersectional Accuracy Disparities in
  Commercial Gender Classification. *Proceedings of Machine Learning Research*, 81, 77–91.
  [Primary paper](https://proceedings.mlr.press/v81/buolamwini18a.html).
- Kearns, M., Neel, S., Roth, A., & Wu, Z. S. (2018). Preventing Fairness Gerrymandering:
  Auditing and Learning for Subgroup Fairness. *Proceedings of Machine Learning Research*, 80,
  2564–2572. [Primary paper](https://proceedings.mlr.press/v80/kearns18a.html).

### Measurement and demographic-data standards

- American Educational Research Association, American Psychological Association, & National
  Council on Measurement in Education (2014). *Standards for Educational and Psychological
  Testing*. [Official PDF](https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf).
- National Center for Education Statistics. Standard 2-6: Educational testing, validity, and
  fairness. [Official standard](https://nces.ed.gov/statprog/2002/std2_6.asp).
- National Academies of Sciences, Engineering, and Medicine (2022). *Measuring Sex, Gender
  Identity, and Sexual Orientation*. Washington, DC: The National Academies Press.
  [doi:10.17226/26424](https://doi.org/10.17226/26424).
- Schwartz, R. et al. (2022). *Towards a Standard for Identifying and Managing Bias in Artificial
  Intelligence*. NIST Special Publication 1270. National Institute of Standards and Technology.
  [doi:10.6028/NIST.SP.1270](https://doi.org/10.6028/NIST.SP.1270).
- Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts,
  K. (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial
  Intelligence Profile*. NIST AI 600-1. National Institute of Standards and Technology.
  [doi:10.6028/NIST.AI.600-1](https://doi.org/10.6028/NIST.AI.600-1).

### Recommender systems and cold-start

- Big-Five, MBTI, Eysenck or HEXACO: The Ideal Personality Model for Personality-aware
  Recommendation Systems. arXiv:2106.03060.
- User Cold-start Problem in Multi-armed Bandits. ACM TORS.
- Bandit algorithms to personalize educational chatbots. *Machine Learning* (Springer).
