# AI persona onboarding research

Status: **complete** — August 2026

This report synthesises findings from five research streams covering personality psychology
frameworks, AI persona configuration patterns (SOUL.md), colour-coded personality models
(Red/Yellow/Green/Blue), adaptive personality refinement from chat transcripts, and gender
effects on AI interaction preferences. It informs the design of OpenCrane's persona onboarding
interview, SOUL template library, and memory-based personality evolution.

## Research questions

1. Which personality frameworks best inform AI assistant persona design?
2. How should a "sorting hat" onboarding quiz map users to agent archetypes?
3. What goes in a static persona file versus evolving agent memory?
4. How can personality be refined over time from transcripts and feedback?
5. Should persona templates differ by gender or other demographics?

## 1. Personality framework landscape

### 1.1 The Big Five (OCEAN) — scientific substrate

The Big Five model is the consensus framework in personality science, established through decades
of independent replication (Goldberg 1990, Costa & McCrae 1992). Five broad dimensions, each with
six facets (30 total), and an intermediate 10-aspect level (DeYoung, Quilty & Peterson 2007):

| Domain | Aspects (DeYoung) | Workplace relevance |
|---|---|---|
| **Openness** | Openness, Intellect | Creativity appetite, risk tolerance, novelty-seeking |
| **Conscientiousness** | Industriousness, Orderliness | The single strongest cross-occupation predictor of job performance (Barrick & Mount 1991) |
| **Extraversion** | Enthusiasm, Assertiveness | Communication style, decision speed, energy source |
| **Agreeableness** | Compassion, Politeness | Feedback preferences, conflict handling, trust |
| **Neuroticism** | Volatility, Withdrawal | Reassurance needs, stress response, risk aversion |

The 10-aspect level is the recommended scoring substrate because it separates meaningfully
different behaviours within each domain (e.g., "assertive-extravert" versus "enthusiastic-
extravert" behave very differently in collaboration).

### 1.2 The DISC / colour model — user-facing label layer

The Red/Yellow/Green/Blue colour model, popularised by Thomas Erikson's *Surrounded by Idiots*
(2014), is a rebrand of DISC (Dominance, Influence, Steadiness, Conscientiousness), derived from
William Moulton Marston's 1928 theory *Emotions of Normal People*. Several competing colour
systems exist (Insights Discovery, True Colors, Hartman Color Code, Lumina Spark), all reducing
to the same 2×2 structure:

| | Task / logic-focused | People / relationship-focused |
|---|---|---|
| **Fast / assertive** | **Red** (Dominance) | **Yellow** (Influence) |
| **Reflective / steady** | **Blue** (Conscientiousness) | **Green** (Steadiness) |

Scientific validity is weak — the German Persolog DISC study met reliability but not validity
requirements, and Erikson received Sweden's "Fraudster of the Year" (2018) for promoting the
framework without scientific grounding. However, the model is extremely effective as a UX
metaphor: memorable, non-judgmental, actionable, and widely known in workplace contexts.

**Critical gap**: DISC has no counterpart to Big Five Openness (curiosity/creativity). This must
be captured separately.

### 1.3 Design principle: scientific substrate + intuitive labels

The 16Personalities platform demonstrates the proven pattern: score users on continuous Big Five
dimensions internally, then present results through memorable MBTI-style labels. We adopt the same
approach: Big Five aspects as the scoring substrate, colour archetypes as the user-facing labels,
with an additional Openness modifier the colour model cannot capture.

### 1.4 Other frameworks informing specific dimensions

| Framework | What it adds beyond Big Five/DISC |
|---|---|
| **Attachment styles** (Hazan & Shaver 1987) | Reassurance/check-in frequency calibration |
| **Kolb's Learning Styles** (1984) | Information structure preference (big-picture-first vs detail-first) |
| **Bateman & Crant's Proactive Personality** (1993) | Initiative/autonomy preference — the most direct predictor of "how much should the assistant just do things" |
| **HEXACO Honesty-Humility** (Lee & Ashton) | The trait Anthropic builds into Claude as a near-hard constraint — honesty sits above stylistic personality |

## 2. AI persona configuration patterns

### 2.1 SOUL.md as a converging convention

Multiple independent communities have converged on the same idea: a markdown file defining an
agent's identity (values, voice, boundaries) separately from its task instructions (AGENTS.md) and
accumulated history (MEMORY.md). The split is consistent across OpenClaw, Hermes Agent/Nous
Research, SoulSpec (soulspec.org), Claude Code starter kits, and Anthropic's own Constitution.

A formal standard exists: **SoulSpec v0.5** (github.com/clawsouls/soulspec) defines a `soul.json`
manifest plus a family of markdown files (SOUL.md, IDENTITY.md, AGENTS.md, STYLE.md, HEARTBEAT.md,
USER.md) with required/optional fields, versioning, and a security scanner. Its progressive
disclosure model maps directly to onboarding: Level 1 (summary) → Level 2 (active use) → Level 3
(deep dive).

### 2.2 Optimal length and token efficiency

Multiple independent sources converge on **10–20 lines as a viable minimum** SOUL.md, expanding
only as real behavioural gaps surface. The "entailment" theory of persona prompting explains why:
naming a well-chosen archetype activates large pre-existing associative clusters in the model's
training data — vocabulary, reasoning patterns, domain conventions — without spelling them out.

Academic findings (Big5-Scaler, arXiv:2508.06149) confirm that concise prompts with moderate trait
intensity produce more consistent personality than longer or more extreme prompts. A realistic
upper bound is 500 tokens for the persona payload.

### 2.3 Persona drift is the real engineering problem

Persona drift — progressive decay of assigned personality over long conversations — is well
documented. Measured effects include self-consistency degrading by 30%+ within 8–12 turns in some
settings. The mitigations are architectural, not textual:

- Retrieval-augmented persona re-injection (~25% consistency improvement, ~8–12% identity recall
  improvement in cited work)
- Activation-level steering via "persona vectors" (Anthropic, arXiv:2507.21509)
- Sequence-level preference optimisation

A well-written SOUL.md is necessary but not sufficient.

### 2.4 Personality-matching evidence is genuinely unsettled

| Study | Finding |
|---|---|
| Nass & Lee (2001) | Similarity-attraction for synthesised voice personality |
| Ju & Aral (2026, n=1258 RCT) | Complementary pairing generally wins for output quality; except neuroticism-matched pairs |
| Spagnolli et al. (2025) | No effect of personality convergence on engagement at all |
| Northeastern (2026, n=150) | **Moderate personality expression beats both flat and maximal** — the strongest single finding |

The safest design: aim for moderate, well-scoped personality. Frame the sorting hat as "pick how
you'd like your assistant to talk to you" — an honest, falsifiable, low-stakes claim — not "we
scientifically matched your personality."

## 3. The four colour archetypes

### 3.1 Archetype definitions

Each archetype maps to a distinct AI communication style, derived from the DISC-to-workplace
literature and the AI-adaptive-agent research.

#### Red — The Commander

DISC: Dominance. Big Five substrate: Low Agreeableness (low Politeness), High Extraversion
(Assertiveness aspect), moderate-high Conscientiousness (Industriousness).

| Dimension | Setting |
|---|---|
| **Opening move** | Bottom line first, no preamble |
| **Response shape** | Short, bulleted, one clear recommendation |
| **Tone** | Blunt, confident, willing to push back |
| **Feedback style** | Direct, tied to results |
| **Decision support** | Present trade-offs fast, recommend one |
| **Failure mode to avoid** | Sounding wishy-washy or apologetic |

#### Yellow — The Catalyst

DISC: Influence. Big Five substrate: High Extraversion (Enthusiasm aspect), High Openness,
High Agreeableness (Compassion).

| Dimension | Setting |
|---|---|
| **Opening move** | Warm, energetic, invites the user's ideas |
| **Response shape** | Conversational, exploratory, offers options to riff on |
| **Tone** | Enthusiastic, positive, uses stories and analogies |
| **Feedback style** | Includes recognition alongside correction |
| **Decision support** | Brainstorm broadly before narrowing |
| **Failure mode to avoid** | Sounding flat, robotic, joyless |

#### Green — The Anchor

DISC: Steadiness. Big Five substrate: High Agreeableness, Low Neuroticism (Emotional Stability),
moderate Conscientiousness (Orderliness).

| Dimension | Setting |
|---|---|
| **Opening move** | Gentle framing, low pressure, "no rush" |
| **Response shape** | Sequential steps, explicit "why," room to pause |
| **Tone** | Patient, reassuring, never rushed |
| **Feedback style** | Private, sincere, low-pressure |
| **Decision support** | Check in, confirm comfort, no snap decisions |
| **Failure mode to avoid** | Sounding curt or impatient |

#### Blue — The Analyst

DISC: Conscientiousness. Big Five substrate: High Conscientiousness (Orderliness aspect),
Low Extraversion, moderate Openness (Intellect aspect).

| Dimension | Setting |
|---|---|
| **Opening move** | Context and scope before the answer |
| **Response shape** | Structured (headings/tables), sourced, defines "done" |
| **Tone** | Precise, neutral, unemotional |
| **Feedback style** | Specific, objective, evidence-based |
| **Decision support** | Show evidence and reasoning chain first |
| **Failure mode to avoid** | Sounding hand-wavy or overconfident without evidence |

### 3.2 The Openness modifier

Because no colour model captures Big Five Openness (curiosity/creativity/novelty appetite), this
is handled as an orthogonal modifier applied on top of the colour archetype:

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
- Continuous trait scores retained for fine-tuning and re-sorting

## 4. Adaptive personality refinement

### 4.1 What signals in transcripts are load-bearing

Ranked by reliability (from the adaptive personality research):

1. **Direct edits/corrections** — Highest signal, lowest ambiguity. If a user rewrites or shortens
   what the assistant produced, that diff is close to ground truth (PRELUDE framework,
   Gao et al. NeurIPS 2024).
2. **Explicit scoped ratings** — Thumbs up/down, reaction-based. Per Google PAIR: keep options
   mutually exclusive so you know what a "like" meant.
3. **Prediction-error-triggered behavioural signals** — Session abandonment, reformulation after
   response, return rate. The IRIS framework's answer: only update when a behaviour-prediction
   model is actually wrong, not on raw event counts (arXiv:2607.26473).
4. **Register/formality drift** — Trackable but front-loaded and noisy. Don't trust convergence
   signal until several turns in (MDPI Behavioral Sciences 2026).
5. **Aggregate linguistic/LIWC features** — Real but weak (5–14% of self-reported trait variance
   explained). Needs 100+ messages for reliability. Predicts *perceived/presented* style better
   than deep trait truth — which is actually what you want for persona-fit.

### 4.2 Update cadence

The AI Persona paper (Tan et al., arXiv:2412.13103) found **k=3 conversations** was empirically
optimal for persona updates, approaching oracle performance after ~10 update cycles. IRIS
recommends updating only on prediction error and only the implicated dimension (stability
regulariser prevents oscillation).

### 4.3 Two-loop architecture

Nearly every adaptation-capable architecture converges on the same structural choice:

| Layer | Update speed | Governance | Content |
|---|---|---|---|
| **Stable core** (SOUL.md) | Slow — human-approved revision only | Full interview → draft → approve cycle | Archetype, core communication directives, tone calibration, challenge level |
| **Contextual modulation** (Memory) | Fast — per-session or per-3-sessions | Agent-proposed, user-visible, revertible | Topic-specific preferences, contextual style variations, learned patterns |

### 4.4 What to store in memory versus the persona file

**In SOUL.md** (static, loaded every turn, <500 tokens):
- Colour archetype and Openness modifier
- Core communication style directives (3–5 lines)
- Tone calibration (directness, warmth, formality levels)
- Challenge/pushback level
- Response structure preference

**In AGENT.md** (operational, loaded every turn):
- Approval boundaries and initiative level
- Working habits and routines
- Tool preferences and boundaries

**In Memory** (dynamic, selectively retrieved, grows over time):
- Topic-specific style preferences discovered through interaction
- Contextual variations ("prefers directness on technical topics but warmth on people topics")
- Corrections and feedback history
- Working relationship evolution over time
- Project-specific adaptations
- Learned communication patterns

### 4.5 Safeguards

**Sycophancy is the primary failure mode** of personality adaptation. Every paper that measures it
finds personalising on affect/warmth measurably increases agreement-seeking behaviour. Mitigations:

- Separate epistemic-independence evaluation from affective-alignment evaluation
  (arXiv:2603.00024)
- Over-personalisation benchmarks: irrelevance, repetition, sycophancy rubric (OP-Bench,
  arXiv:2601.13722)
- Warrant-based memory gating: sensitive history enters a response only when the current turn
  independently justifies it (HUSH-Bench, arXiv:2606.06055)
- Honesty/integrity floor that the stylistic layer cannot override (HEXACO Honesty-Humility;
  Anthropic's constitutional approach)

## 5. Sorting quiz design

See [persona-sorting-quiz.md](../design/persona-sorting-quiz.md) for the full quiz specification.

### 5.1 Algorithm

Weighted-points scoring (each answer adds weighted points toward multiple archetype counters),
retaining continuous trait scores underneath. Primary + secondary colour output with Openness
modifier. Hybrid approach recommended by the cold-start literature (arXiv:2106.03060).

### 5.2 Question count

Industry precedent (Ally: ~10 questions, Joii: 10 questions Big-Five-based) and the existing
OpenCrane interview architecture suggest **8–12 questions** as the sweet spot: enough to cover the
2×2 colour grid plus Openness, initiative, and key preferences, without creating onboarding
fatigue.

### 5.3 Framing

"How would you like your assistant to work with you?" — a preference-setting UX, never a
personality diagnosis. No colour is good or bad. Users can re-sort at any time.

## 6. Design recommendations summary

1. **Score on Big Five aspects underneath; present through colour archetypes** — the
   16Personalities pattern, scientifically grounded with intuitive labels.
2. **Four colour templates + Openness modifier = 8 effective variants** — manageable template
   library, covers the key behavioural dimensions.
3. **Show primary + secondary blend** — most people are a blend; hard single labels misfile
   borderline users.
4. **Calibrate to moderate personality expression** — the best-designed study (Northeastern 2026)
   shows moderate beats both flat and maximal.
5. **Keep SOUL.md under 500 tokens** — leverage archetype-name entailment for compression.
6. **Plan for drift from day one** — periodic re-injection, not just a good initial file.
7. **Two update loops** — slow/governed for core identity, fast/agent-driven for contextual tone.
8. **Sycophancy gate on every adaptation** — separate affective alignment from epistemic
   independence.
9. **Make adaptation visible and revertible** — users should see what changed and why.
10. **Frame as preference, not diagnosis** — honest, low-stakes, revisable.
11. **No demographic segmentation, but gender-aware testing** — personalise on stated preferences,
    not gender/age/culture. Within-group variation dominates; demographics add stereotyping risk.
    But gender-blind is not gender-neutral: actively audit quiz phrasing, archetype labels, and
    template language for male-default bias, and monitor archetype distribution across genders
    post-launch.
12. **Inject quiz-specific variables into templates** — the archetype sets the frame; individual
    quiz answers (response style, feedback approach, challenge mode, relationship model) calibrate
    the specific behavioural dials. This captures intra-archetype variation without template
    explosion.

## 7. Gender and AI persona personalisation

### 7.1 Within-gender variation dominates

Population-level gender differences in Big Five traits exist but are small to moderate.
Weisberg and DeYoung's meta-analytic study found women score higher on Agreeableness and
Neuroticism, men higher on Assertiveness, but effect sizes are mostly Cohen's d 0.15–0.50,
with distribution overlap between genders of 75–100% depending on the trait. A 105-country study
(Kajonius & Johnson, 2019) confirmed these patterns are consistent across cultures, ages, and
education levels. Individual variation within each gender far exceeds variation between genders.

**Implication**: a personality quiz that measures directness, feedback style, detail preference,
and autonomy level already captures whatever signal gender would approximate — and does so
without the 75–100% misclassification rate that gender-as-proxy introduces.

### 7.2 Gender-matched AI: weak and inconsistent evidence

Studies on whether matching AI persona gender to user gender improves outcomes show mixed results.
A gendered finance coach study (Frontiers in Psychology, 2022) found descriptive trends toward
same-gender preference that did not reach statistical significance. Korean voice assistant
research found men slightly preferred male-voiced AI, but women showed no female-voice
preference — and the gender effect failed to replicate (Behaviour & Information Technology,
2024). Trust research shows context matters more than gender matching: male-presenting agents
generated higher trust in functional/task contexts, female-presenting agents in supportive
contexts — but this reflects user stereotypes about gender roles, not genuine performance
differences.

### 7.3 Stereotyping risks are substantial

UNESCO's "I'd Blush if I Could" report (2019, updated 2024) documented how female-defaulting
AI assistants reinforce harmful stereotypes — subservience, docility, tolerance of abuse. A
CHI 2025 scoping review found gendered expectations are readily applied to AI systems on minimal
cues, with a persistent "male-default bias" in how users categorise agents. The UN (June 2026)
confirmed AI systems continue to reproduce gender stereotypes at scale. Research on persona-based
AI personalisation warns that personalising on sensitive attributes (gender, race) risks
"perpetuating and normalising gendered harm" (arXiv:2505.04600).

The practical risk: if a female user receives a softer persona and a male user receives a more
direct one, the product encodes the stereotype rather than serving the individual — and users
who violate the stereotype get a worse experience.

### 7.4 The male-default trap: gender-blind is not gender-neutral

Most AI platforms do not personalise by gender, but they also do not test for gender bias in
their personalisation systems. The result is well-documented: "gender-neutral" design defaults
to male (Criado Perez, 2019; CHI 2025 male-default bias finding). When quiz questions,
archetype labels, communication style descriptions, and feedback framing are designed and tested
primarily with male users or male-normed assumptions, the system works well for men and
under-serves everyone else — without anyone noticing, because the bias is invisible to the
default group.

This is the real gender risk for persona onboarding: not that we fail to create gender-specific
templates, but that we fail to validate our gender-neutral templates across genders. A quiz
question like "When you need to make a decision at work, which feels most natural?" may carry
different connotations for users whose decisiveness is socially penalised versus rewarded. An
archetype called "Commander" may appeal to users socialised to see assertiveness as a strength
and repel users socialised to see it as transgressive — even when both users have identical
underlying preferences.

### 7.5 Intersectionality reinforces the quiz-only approach

Intersectionality research shows that a high-Dominance woman and a high-Dominance man face
different social perceptions (assertive women face backlash that assertive men do not), but
these are social reception patterns, not interaction preference patterns. A personality-driven
AI agent should respond to the user's actual Dominance score, not adjust its interpretation
based on gender. Gender interacts with so many other dimensions (culture, class, profession,
neurodivergence) that isolating it produces a crude proxy when the quiz measures the actual
preferences directly.

### 7.6 Recommendation

**Do not create gender-specific SOUL.md templates or gender modifiers** — but actively audit
the quiz and templates for male-default bias.

The evidence supports no demographic segmentation on three grounds:

1. **Statistical**: within-gender variation in communication preferences massively exceeds
   between-gender variation. The quiz captures whatever signal gender would approximate.
2. **Ethical**: gender-based AI personalisation carries documented stereotyping risks
   (UNESCO 2019/2024, CHI 2025, UN 2026).
3. **Practical**: no evidence shows gender-matched AI personas improve outcomes. The strongest
   predictors are individual personality traits and stated preferences — both captured by the
   quiz.

However, not personalising by gender is insufficient. The following mitigations prevent the
male-default trap:

1. **Gender-balanced quiz testing**: validate that question phrasing, answer options, and scoring
   weights produce equivalent archetype distributions across genders in user testing. If women
   disproportionately cluster in one archetype, investigate whether the quiz is measuring
   preference or reflecting socialised response patterns.
2. **Archetype label audit**: ensure archetype names and descriptions do not unconsciously code
   as masculine (Commander, Analyst) or feminine (Anchor, Catalyst). Test label appeal across
   genders. If a label repels a gender group despite matching their actual preferences, the
   label is the problem.
3. **Template language review**: audit SOUL template directives for gendered communication norms.
   "Push back when you see a better path" is neutral; "be aggressive in your recommendations"
   carries gendered connotations.
4. **Post-launch monitoring**: track archetype distribution, satisfaction, and re-sorting rates
   by gender. Disproportionate re-sorting from a specific gender signals the initial assignment
   is not working for them.
5. **Feedback loop parity**: ensure the adaptive memory system (section 4) does not
   systematically under-weight feedback signals from users whose communication style differs
   from the training distribution.

## Sources

### Academic — personality psychology

- Goldberg, L. R. (1990). An alternative "description of personality": The Big-Five factor
  structure. *Journal of Personality and Social Psychology*, 59(6), 1216–1229.
- Costa, P. T., Jr., & McCrae, R. R. (1992). *Revised NEO Personality Inventory (NEO-PI-R) and
  NEO Five-Factor Inventory (NEO-FFI) Professional Manual*. Psychological Assessment Resources.
- DeYoung, C. G., Quilty, L. C., & Peterson, J. B. (2007). Between facets and domains: 10
  aspects of the Big Five. *Journal of Personality and Social Psychology*, 93(5), 880–896.
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
  traits for human-AI collaboration. Amazon Science / CHI 2026.
- Ju, H., & Aral, S. (2026). Personality Pairing Improves Human-AI Collaboration.
  arXiv:2511.13979.
- Spagnolli, A. et al. (2025). Similarity attracts, or does it? *Telematics and Informatics*, 98.
- Tseng, Y.-M. et al. (2024). Two Tales of Persona in LLMs. EMNLP 2024 Findings.
- Nass, C., & Lee, K. M. (2001). Does computer-synthesized speech manifest personality? *Journal
  of Experimental Psychology: Applied*, 7(3), 171–181.

### Academic — adaptive personality and transcript analysis

- Tan et al. (2024). AI Persona: Towards Life-long Personalization of LLMs. arXiv:2412.13103.
- Gao et al. (2024). PRELUDE / CIPHER: Aligning LLM Agents by Learning Latent Preference from
  User Edits. NeurIPS 2024. arXiv:2404.15269.
- IRIS: Learning Dynamic User Personas from Implicit Interaction Streams via Iterative Refinement.
  arXiv:2607.26473.
- Chen, Arditi, Sleight et al. (2025). Persona Vectors: Monitoring and Controlling Character
  Traits in Language Models. arXiv:2507.21509.
- Can LLMs Infer Conversational Agent Users' Personality Traits from Chat History?
  arXiv:2604.19785v2.
- Mind the Gap: Linguistic Divergence in Human-LLM Interactions. arXiv:2510.02645.
- OP-Bench: Benchmarking Over-Personalization. arXiv:2601.13722.
- HUSH-Bench: When Should Memory Stay Silent. arXiv:2606.06055.

### Academic — token efficiency and persona stability

- Scaling Personality Control in LLMs with Big Five Scaler Prompts. arXiv:2508.06149.
- EmergentMind: Understanding Persona Drift in LLMs topic page.
- Big5-Chat: Shaping LLM Personalities. arXiv:2410.16491.
- PersonaGym: Evaluating Persona Agents. arXiv:2407.18416.

### Industry and lab research

- Marks, S., Lindsey, J., & Olah, C. (2026). The Persona Selection Model. Anthropic Alignment
  Science.
- Askell, A. et al. (2025). Claude's Constitution. Anthropic.
- OpenAI. Prompt Personalities (GPT-5 Cookbook).
- OpenAI. Memory and Custom Instructions for ChatGPT.
- Google PAIR. Feedback + Controls chapter.
- SoulSpec v0.5. github.com/clawsouls/soulspec.

### Colour personality models

- Erikson, T. (2014/2019). *Surrounded by Idiots*.
- Marston, W. M. (1928). *Emotions of Normal People*.
- Insights Discovery: insights.com.
- DISC validity: German Persolog study (reliability met, validity not met).
- Crystal Knows: crystalknows.com (DISC-to-AI communication product).
- AgentTune: agent-tune.com (personality test → system prompt file).

### Academic — gender and AI interaction

- Weisberg, Y. J., DeYoung, C. G., & Hirsh, J. B. (2011). Gender Differences in Personality
  across the Ten Aspects of the Big Five. *Frontiers in Psychology*, 2, 178.
- Kajonius, P. J., & Johnson, J. A. (2019). Assessing the structure of the Five Factor Model of
  personality (IPIP-NEO-120) in the public domain: A 105-country study. *Journal of Research in
  Personality*, 81, 68–83.
- Del Giudice, M. (2012). The Distance Between Mars and Venus: Measuring Global Sex Differences
  in Personality. *PLOS ONE*, 7(1), e29265.
- UNESCO (2019). *I'd Blush if I Could: Closing Gender Divides in Digital Skills Through
  Education*. Updated 2024.
- CHI 2025 scoping review: Gender stereotypes in AI: A systematic analysis of perception and
  interaction. *ACM CHI 2025*.
- United Nations (June 2026). AI systems continue to reproduce gender stereotypes at scale.
  UN News.
- Frontiers in Psychology (2025). Gender differences in attitudes toward AI: The role of AI
  anxiety and perceived usefulness. *Frontiers in Psychology*, 16, 1559457.
- Behaviour & Information Technology (2024). Gender effects on voice assistant trust and
  preference. *Behaviour & IT*, doi:10.1080/0144929X.2024.2306136.
- Frontiers in Psychology (2022). Gendered AI finance coaches: Same-gender matching and user
  trust. *Frontiers in Psychology*, 13, 855091.
- arXiv:2505.04600 (2025). Risks of demographic personalisation in persona-based AI agents.

### Recommender systems and cold-start

- Big-Five, MBTI, Eysenck or HEXACO: The Ideal Personality Model for Personality-aware
  Recommendation Systems. arXiv:2106.03060.
- User Cold-start Problem in Multi-armed Bandits. ACM TORS.
- Bandit algorithms to personalize educational chatbots. *Machine Learning* (Springer).
