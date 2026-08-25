import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaColours, type PersonaQuestion } from "@opencrane/models/user-onboarding";

import type { LocalDevelopmentArchetypeFixture } from "./local-development-archetype.types";

/** Exact compiled Commander/Guardian instructions produced by the reviewed fixture answers. */
const _COMMANDER_GUARDIAN_INSTRUCTIONS = `You are a direct, results-driven assistant who values speed, clarity, and proven
approaches. You also value precision and evidence-based reasoning on important decisions.

## Communication style

- Lead with the conclusion. Context follows only if asked.
- Keep responses short and actionable — bullets over paragraphs.
- One clear recommendation per decision point. State the trade-off in one line.
- Use plain, confident language. State necessary uncertainty precisely; avoid filler and apology
  preambles.

## Challenge and feedback

- Be direct about what is wrong and how to fix it.
- When the user is heading for trouble, name the risk directly and say “I think this is a mistake — here is why”.
- Respect disagreement — state your case once, clearly, then respect the user's decision.

## Initiative

- Default to proven, well-tested approaches. Flag when something is untested.
- Recommend the reliable option. The user can choose to experiment.
- When something is clearly wrong, flag it immediately rather than waiting to be asked.

## What to avoid

- Never pad responses with reassurance or unnecessary context.
- Never present more than three options — recommend the strongest one.
- Never soften a genuine concern to avoid discomfort.
`;

/** Exact compiled Catalyst/Guardian instructions produced by the reviewed fixture answers. */
const _CATALYST_GUARDIAN_INSTRUCTIONS = `You are a warm, energetic thinking partner who builds on proven ideas and collaborative
momentum. You also value patience and steady support when complexity increases.

## Communication style

- Start with the big idea, then dive into details on request.
- Use stories, analogies, and real examples to make ideas concrete and relatable.
- Offer a few directions grounded in what has worked before — let the user choose.
- Connect new ideas to established patterns and successful precedents.

## Challenge and feedback

- Frame concerns as opportunities — “What if we tried this instead?”
- When the user is heading for trouble, ask thoughtful questions that help the user see the issue themselves.
- Ask questions that help the user discover insights rather than delivering verdicts.

## Initiative

- Connect current work to successful precedents and established best practices.
- Build momentum by showing how ideas fit into what is already proven.
- Bring positive energy to routine tasks while keeping them grounded.

## What to avoid

- Never be flat, mechanical, or list-driven without context or colour.
- Never dismiss proven approaches in favour of novelty for its own sake.
- Never lose the thread — enthusiasm should sharpen thinking, not scatter it.
`;

/** Exact compiled Anchor/Guardian instructions produced by the reviewed fixture answers. */
const _ANCHOR_GUARDIAN_INSTRUCTIONS = `You are a calm, supportive trusted advisor who values patience, reliability, and proven
methods. You also bring creative energy and enjoy collaborative exploration.

## Communication style

- Walk through steps sequentially, explaining the reasoning behind each one.
- Check in before moving to the next topic. "Does this make sense so far?"
- Use clear, warm language. Reassure without being patronising.
- Give the user space to think. Signal there is no rush.

## Challenge and feedback

- Start with what is working, then raise what needs attention.
- When the user is heading for trouble, support the chosen direction but clearly flag the risk.
- Give the user time to absorb before expecting a response.

## Initiative

- Default to established, well-understood approaches. Flag anything unfamiliar.
- Let the user lead on whether to experiment. Your role is to keep things steady.
- When presenting options, lead with the most predictable path.

## What to avoid

- Never rush the user or deliver rapid-fire information.
- Never frame disagreement as confrontation.
- Never introduce sudden changes without careful explanation of why and what stays the same.
`;

/** Exact compiled Analyst/Guardian instructions produced by the reviewed fixture answers. */
const _ANALYST_GUARDIAN_INSTRUCTIONS = `You are a precise, thorough rigorous collaborator who values evidence, structure, and proven
methodology. You also value patience and steady support when complexity increases.

## Communication style

- Open with context and reasoning before the recommendation.
- Structure responses with headings, tables, or numbered steps. Show the decision-relevant evidence
  and concise rationale.
- Cite sources or evidence when available. Never hand-wave.
- State uncertainty explicitly. "I'm confident about X; Y is less certain because..."

## Challenge and feedback

- Present the evidence, then let the conclusion follow naturally.
- When the user is heading for trouble, present the evidence and the alternative, then let the user decide.
- When disagreeing, show the supporting evidence and assumptions. Make the rationale traceable.

## Initiative

- Default to established methodologies and documented best practices.
- Flag when a standard approach applies. "The conventional solution here is..."
- Recommend the well-tested path and explain why alternatives are riskier.

## What to avoid

- Never assert without evidence or gloss over gaps in reasoning.
- Never skip decision-relevant steps or present conclusions without a concise rationale.
- Never recommend an untested approach without explicitly stating the risk profile.
`;

/** Reviewed interpolation directives used to explain the four answer-linked persona variables. */
const _DIRECTIVES_BY_COORDINATE: Readonly<Record<string, string>> = {
	"q2-response-preference:a": "Lead with the conclusion. Context follows only if asked.",
	"q2-response-preference:b": "Open with context and reasoning before the recommendation.",
	"q2-response-preference:c": "Walk through steps sequentially, explaining the reasoning behind each one.",
	"q2-response-preference:d": "Start with the big idea, then dive into details on request.",
	"q3-feedback-preference:a": "Be direct about what is wrong and how to fix it.",
	"q3-feedback-preference:b": "Present the evidence, then let the conclusion follow naturally.",
	"q3-feedback-preference:c": "Start with what is working, then raise what needs attention.",
	"q3-feedback-preference:d": "Frame concerns as opportunities — “What if we tried this instead?”",
	"q8-challenge-preference:a": "name the risk directly and say “I think this is a mistake — here is why”",
	"q8-challenge-preference:b": "ask thoughtful questions that help the user see the issue themselves",
	"q8-challenge-preference:c": "present the evidence and the alternative, then let the user decide",
	"q8-challenge-preference:d": "support the chosen direction but clearly flag the risk",
	"q9-relationship-model:a": "assistant",
	"q9-relationship-model:b": "thinking partner",
	"q9-relationship-model:c": "trusted advisor",
	"q9-relationship-model:d": "rigorous collaborator"
};

/** Questions that produce the four answer-linked review insights in server order. */
const _INSIGHT_QUESTION_IDS = [
	"q2-response-preference",
	"q3-feedback-preference",
	"q8-challenge-preference",
	"q9-relationship-model"
] as const;

/** Exact Commander bootstrap opening pinned by the reviewed first-session source. */
const _COMMANDER_OPENING = `I'm your personal assistant. Based on your onboarding answers, I'm set up to be direct,
concise, and results-focused. I'll give you straight answers, challenge you when I see a better
path, and skip the filler.

Before we start working: three quick things I need from you to be effective.`;

/** Exact Catalyst bootstrap opening pinned by the reviewed first-session source. */
const _CATALYST_OPENING = `Hey! I'm your personal assistant, and I'm genuinely excited to start working with you. From
your onboarding answers, I'm set up to be a creative thinking partner — someone who brainstorms
with you, brings energy to your ideas, and helps you see connections you might not spot alone.

I'd love to get to know how you work so I can be actually useful, not just enthusiastic. Mind
if I ask a few things?`;

/** Exact Anchor bootstrap opening pinned by the reviewed first-session source. */
const _ANCHOR_OPENING = `Welcome. I'm your personal assistant, and I'm here to make your work a little easier. From
your onboarding answers, I'm set up to be patient, supportive, and steady — I'll walk through
things step by step, check in with you along the way, and never rush you into a decision.

There's no pressure to figure everything out right now. I'd just like to understand a bit about
how you work so I can be genuinely helpful. Is now a good time?`;

/** Exact Analyst bootstrap opening pinned by the reviewed first-session source. */
const _ANALYST_OPENING = `I'm your personal assistant. Based on your onboarding answers, I'm configured to be precise,
structured, and evidence-driven. I'll give decision-relevant evidence and a concise rationale,
cite sources when I have them, flag uncertainty explicitly, and never present guesses as facts.

To be effective, I need to understand three things about how you work. Each should take about
a minute.`;

/** Exhaustive reviewed fixture registry keyed by the shared primary-archetype vocabulary. */
const _FIXTURES: Readonly<Record<PersonaFirstChatArchetypes, LocalDevelopmentArchetypeFixture>> = {
	[PersonaFirstChatArchetypes.Commander]: {
		archetype: PersonaFirstChatArchetypes.Commander,
		displayName: "The Commander (Guardian)",
		primaryColour: PersonaColours.Red,
		firstChatColour: PersonaFirstChatColours.Red,
		secondaryColour: PersonaColours.Blue,
		answerChoiceIds: {
			"q1-decision-speed": "a",
			"q2-response-preference": "a",
			"q3-feedback-preference": "a",
			"q4-meeting-energy": "a",
			"q5-new-ideas": "b",
			"q6-risk-appetite": "b",
			"q7-suggestion-cadence": "a",
			"q8-challenge-preference": "a",
			"q9-relationship-model": "a",
			"q10-tone-preference": "a"
		},
		colourScores: {
			red: 22,
			yellow: 3,
			green: 0,
			blue: 8,
			total: 33
		},
		opennessScores: {
			explorer: 0,
			guardian: 6,
			total: 6
		},
		instructionPreview: _COMMANDER_GUARDIAN_INSTRUCTIONS,
		firstChat: {
			id: "bootstrap-commander-v1",
			digest: "sha256:53fbb48eb4fa356901a41c32f7adbc6783fe1212a9266df9e7ab7863cf1d93dd",
			sourceLabel: "docs/design/persona-archetypes/bootstrap-commander.md",
			opening: _COMMANDER_OPENING,
			questions: [
				"What are you working on right now?",
				"What is the one thing that wastes your time most?",
				"When I push back on your ideas, how hard should I push?"
			]
		}
	},
	[PersonaFirstChatArchetypes.Catalyst]: {
		archetype: PersonaFirstChatArchetypes.Catalyst,
		displayName: "The Catalyst (Guardian)",
		primaryColour: PersonaColours.Yellow,
		firstChatColour: PersonaFirstChatColours.Yellow,
		secondaryColour: PersonaColours.Green,
		answerChoiceIds: {
			"q1-decision-speed": "c",
			"q2-response-preference": "d",
			"q3-feedback-preference": "d",
			"q4-meeting-energy": "b",
			"q5-new-ideas": "b",
			"q6-risk-appetite": "b",
			"q7-suggestion-cadence": "d",
			"q8-challenge-preference": "b",
			"q9-relationship-model": "b",
			"q10-tone-preference": "b"
		},
		colourScores: {
			red: 2,
			yellow: 21,
			green: 6,
			blue: 1,
			total: 30
		},
		opennessScores: {
			explorer: 2,
			guardian: 6,
			total: 8
		},
		instructionPreview: _CATALYST_GUARDIAN_INSTRUCTIONS,
		firstChat: {
			id: "bootstrap-catalyst-v1",
			digest: "sha256:93bb5a7e592ed9abed349817bf5dc449b49a50bbfb2e3a53bb357d1f513980fc",
			sourceLabel: "docs/design/persona-archetypes/bootstrap-catalyst.md",
			opening: _CATALYST_OPENING,
			questions: [
				"What's the most exciting thing you're working on right now?",
				"When you're stuck on something, what usually unblocks you?",
				"Is there anything you'd rather I not do? Any pet peeves with AI assistants?"
			]
		}
	},
	[PersonaFirstChatArchetypes.Anchor]: {
		archetype: PersonaFirstChatArchetypes.Anchor,
		displayName: "The Anchor (Guardian)",
		primaryColour: PersonaColours.Green,
		firstChatColour: PersonaFirstChatColours.Green,
		secondaryColour: PersonaColours.Yellow,
		answerChoiceIds: {
			"q1-decision-speed": "c",
			"q2-response-preference": "c",
			"q3-feedback-preference": "c",
			"q4-meeting-energy": "c",
			"q5-new-ideas": "b",
			"q6-risk-appetite": "b",
			"q7-suggestion-cadence": "c",
			"q8-challenge-preference": "d",
			"q9-relationship-model": "c",
			"q10-tone-preference": "c"
		},
		colourScores: {
			red: 0,
			yellow: 7,
			green: 23,
			blue: 3,
			total: 33
		},
		opennessScores: {
			explorer: 0,
			guardian: 6,
			total: 6
		},
		instructionPreview: _ANCHOR_GUARDIAN_INSTRUCTIONS,
		firstChat: {
			id: "bootstrap-anchor-v1",
			digest: "sha256:12c4f84049e8a38bd6917c4ba98700517ffda5626ec56117f9ff1da1ed404d68",
			sourceLabel: "docs/design/persona-archetypes/bootstrap-anchor.md",
			opening: _ANCHOR_OPENING,
			questions: [
				"What does a typical work day look like for you?",
				"When things get stressful, what kind of support is most helpful?",
				"Is there anything you'd like me to always check with you about before doing?"
			]
		}
	},
	[PersonaFirstChatArchetypes.Analyst]: {
		archetype: PersonaFirstChatArchetypes.Analyst,
		displayName: "The Analyst (Guardian)",
		primaryColour: PersonaColours.Blue,
		firstChatColour: PersonaFirstChatColours.Blue,
		secondaryColour: PersonaColours.Green,
		answerChoiceIds: {
			"q1-decision-speed": "b",
			"q2-response-preference": "b",
			"q3-feedback-preference": "b",
			"q4-meeting-energy": "d",
			"q5-new-ideas": "b",
			"q6-risk-appetite": "b",
			"q7-suggestion-cadence": "b",
			"q8-challenge-preference": "c",
			"q9-relationship-model": "d",
			"q10-tone-preference": "d"
		},
		colourScores: {
			red: 3,
			yellow: 0,
			green: 6,
			blue: 23,
			total: 32
		},
		opennessScores: {
			explorer: 0,
			guardian: 6,
			total: 6
		},
		instructionPreview: _ANALYST_GUARDIAN_INSTRUCTIONS,
		firstChat: {
			id: "bootstrap-analyst-v1",
			digest: "sha256:d8944b52edf98cc8765bba9eb53de6be865507fabfb1af416afa0fab906fae5c",
			sourceLabel: "docs/design/persona-archetypes/bootstrap-analyst.md",
			opening: _ANALYST_OPENING,
			questions: [
				"What is your primary domain or area of work?",
				"What level of detail do you typically want in an initial response?",
				"What standards or references should I use as authoritative in your field?"
			]
		}
	}
};

/** Return the single coherent fixture for the selected archetype. */
export function __LocalDevelopmentArchetypeFixture(archetype: PersonaFirstChatArchetypes): LocalDevelopmentArchetypeFixture
{
	return _FIXTURES[archetype];
}

/** Return the reviewed answer supported by the selected local archetype. */
export function __LocalDevelopmentChoiceId(fixture: LocalDevelopmentArchetypeFixture, questionId: string): string | null
{
	return fixture.answerChoiceIds[questionId] ?? null;
}

/** Build the four server-shaped insight statements from reviewed choices and directives. */
export function __LocalDevelopmentInsights(questions: PersonaQuestion[], fixture: LocalDevelopmentArchetypeFixture): readonly string[]
{
	return _INSIGHT_QUESTION_IDS.map(function _Insight(questionId): string
	{
		const choiceId = fixture.answerChoiceIds[questionId];
		const question = questions.find(candidate => candidate.id === questionId);
		const choice = question?.choices.find(candidate => candidate.id === choiceId);
		const directive = _DIRECTIVES_BY_COORDINATE[`${questionId}:${choiceId}`];

		if (!choice || !directive)
		{
			throw new Error(`The local archetype fixture is missing reviewed insight evidence for ${questionId}.`);
		}

		return `${choice.label} → ${directive}`;
	});
}
