import { PersonaOnboardingStates, type PersonaOnboardingSnapshot, type PersonaQuestion } from "@opencrane/models/user-onboarding";

/**
 * Reviewed `personal-agent-onboarding` v1 questions copied from the clean database baseline.
 *
 * Keep these values aligned with the immutable live source so Tier 1 exercises the same text and
 * choice layout as a live browser session.
 * @see apps/opencrane/prisma/bootstrap/target-baseline.sql
 */
const _REVIEWED_PERSONA_QUESTIONS: readonly PersonaQuestion[] = [
	{
		id: "q1-decision-speed",
		category: "Pace",
		prompt: "When you need to make a decision at work, which feels most natural?",
		ordinal: 1,
		choices: [
			{
				id: "a",
				label: "Decide quickly with the information I have — I can course-correct later.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Take time to consider the options carefully before committing.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Talk it through with someone I trust, then decide together.",
				ordinal: 3
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q2-response-preference",
		category: "Response",
		prompt: "When your assistant gives you an answer, what matters most?",
		ordinal: 2,
		choices: [
			{
				id: "a",
				label: "Get to the point fast — I'll ask if I need more.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Give me the full picture with context and reasoning.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Walk me through it step by step so I can follow along.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Start with the big idea, then I'll dive into details if interested.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q3-feedback-preference",
		category: "Feedback",
		prompt: "How do you prefer to receive critical feedback?",
		ordinal: 3,
		choices: [
			{
				id: "a",
				label: "Be direct — tell me what's wrong and how to fix it.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Show me the evidence, then let me draw my own conclusion.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Start with what's working, then raise what needs attention.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Frame it as an opportunity — what could we try differently?",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q4-meeting-energy",
		category: "Interaction",
		prompt: "Which describes your ideal interaction with a colleague or assistant?",
		ordinal: 4,
		choices: [
			{
				id: "a",
				label: "Short, focused, outcome-driven — no small talk needed.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Collaborative and energetic — bouncing ideas around.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Calm and supportive — taking time to understand each other.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Structured and thorough — covering everything systematically.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q5-new-ideas",
		category: "Openness",
		prompt: "When facing a problem you've solved before, what do you prefer?",
		ordinal: 5,
		choices: [
			{
				id: "a",
				label: "Try a completely new approach — there might be something better.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Use what worked last time — why reinvent the wheel?",
				ordinal: 2
			},
			{
				id: "c",
				label: "Start with the proven method but be open to improvements.",
				ordinal: 3
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q6-risk-appetite",
		category: "Risk",
		prompt: "When your assistant suggests something, would you rather it…",
		ordinal: 6,
		choices: [
			{
				id: "a",
				label: "Suggest the bold, creative option and let me dial it back.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Suggest the safe, proven option and let me push it further.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Present both and explain the trade-offs.",
				ordinal: 3
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q7-suggestion-cadence",
		category: "Initiative",
		prompt: "How proactively should your assistant surface ideas and recommendations?",
		ordinal: 7,
		choices: [
			{
				id: "a",
				label: "Bring me a concrete recommendation without waiting to be asked.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Suggest options when relevant and wait for my decision.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Check whether I want suggestions before expanding the topic.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Surprise me with ideas I hadn't thought of, but let me choose.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q8-challenge-preference",
		category: "Challenge",
		prompt: "When you're heading down a path your assistant thinks is wrong, it should…",
		ordinal: 8,
		choices: [
			{
				id: "a",
				label: "Tell me directly — “I think this is a mistake, here's why.”",
				ordinal: 1
			},
			{
				id: "b",
				label: "Ask thoughtful questions that help me see the issue myself.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Present the evidence and the alternative, then let me decide.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Support my direction but flag the risk so I'm informed.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q9-relationship-model",
		category: "Relationship",
		prompt: "Which best describes what you want from your assistant?",
		ordinal: 9,
		choices: [
			{
				id: "a",
				label: "A sharp tool — efficient, reliable, no personality needed.",
				ordinal: 1
			},
			{
				id: "b",
				label: "A thinking partner — someone who engages with my ideas.",
				ordinal: 2
			},
			{
				id: "c",
				label: "A trusted advisor — someone who understands my context over time.",
				ordinal: 3
			},
			{
				id: "d",
				label: "A rigorous collaborator — someone who holds me to high standards.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	},
	{
		id: "q10-tone-preference",
		category: "Tone",
		prompt: "Pick the tone that would make you most comfortable working with an AI assistant every day.",
		ordinal: 10,
		choices: [
			{
				id: "a",
				label: "Confident and direct, like a no-nonsense colleague.",
				ordinal: 1
			},
			{
				id: "b",
				label: "Warm and enthusiastic, like an excited collaborator.",
				ordinal: 2
			},
			{
				id: "c",
				label: "Calm and steady, like a patient mentor.",
				ordinal: 3
			},
			{
				id: "d",
				label: "Precise and thorough, like a meticulous analyst.",
				ordinal: 4
			}
		],
		selectedChoiceId: null
	}
];

/** Reviewed answer path whose backend result is reproduced by the Tier 1 presentation fixture. */
const _COMMANDER_GUARDIAN_ANSWER_IDS = {
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
} as const;

/** Return the one reviewed answer supported by the fixed local persona result. */
export function __LocalCommanderGuardianChoiceId(questionId: string): string | null
{
	return _COMMANDER_GUARDIAN_ANSWER_IDS[questionId as keyof typeof _COMMANDER_GUARDIAN_ANSWER_IDS] ?? null;
}

/** Builds the unanswered reviewed persona interview shown when a Tier 1 session starts. */
export function __CreateLocalPersonaInterview(): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-local-1",
		answeredQuestionCount: 0,
		questionCount: _REVIEWED_PERSONA_QUESTIONS.length,
		personaRevisionId: null,
		questions: _REVIEWED_PERSONA_QUESTIONS.map(question => ({
			...question,
			choices: question.choices.map(choice => ({ ...choice }))
		})),
		resolution: null,
		result: null
	};
}
