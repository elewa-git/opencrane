import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { PersonaArchetypeTones } from "@opencrane/elements/ui";

import { PersonaFirstChatComponent } from "./persona-first-chat.component.js";
import { type PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, PersonaFirstChatStates, type PersonaFirstChatTranscriptMessage } from "./persona-first-chat.types.js";

/** Stable personal-agent identity shared by canonical Analyst stories. */
const _ANALYST_IDENTITY: PersonaFirstChatIdentity =
{
	name: "The Analyst",
	initials: "TA",
	archetype: PersonaArchetypeTones.Analyst
};

/** Exact reviewed references exposed in the canonical Analyst stories. */
const _ANALYST_PROVENANCE: PersonaFirstChatProvenance =
{
	personaRevision: "persona-r17",
	scriptLabel: "Analyst first-session bootstrap",
	scriptRevision: "bootstrap-analyst-v1"
};

/** Analyst opening emitted before the first sequential calibration question. */
const _ANALYST_OPENING: readonly PersonaFirstChatTranscriptMessage[] =
[
	{
		id: "event-opening",
		role: PersonaFirstChatMessageRoles.Agent,
		body: "I’m configured to be precise, structured, and evidence-driven. I’ll cite sources when I have them, flag uncertainty explicitly, and never present guesses as facts."
	}
];

/** Canonical Analyst questions in reviewed bootstrap order. */
const _ANALYST_QUESTIONS: readonly PersonaFirstChatQuestion[] =
[
	{ id: "analyst-domain", ordinal: 1, prompt: "What is your primary domain or area of work?" },
	{ id: "analyst-detail", ordinal: 2, prompt: "What level of detail do you typically want in an initial response?" },
	{ id: "analyst-standards", ordinal: 3, prompt: "What standards or references should I use as authoritative in your field?" }
];

/** Storybook metadata for the feature-owned first-chat composition. */
const meta: Meta<PersonaFirstChatComponent> =
{
	title: "Onboarding/Persona first chat",
	component: PersonaFirstChatComponent,
	tags: ["autodocs"],
	args:
	{
		identity: _ANALYST_IDENTITY,
		provenance: _ANALYST_PROVENANCE,
		transcript: _ANALYST_OPENING,
		currentQuestion: _ANALYST_QUESTIONS[0],
		state: PersonaFirstChatStates.AwaitingCalibration,
		draftAnswer: ""
	},
	render: function render(args)
	{
		return {
			props:
			{
				...args,
				submittedAnswer: "",
				retryCount: 0
			},
			template: `
				<wo-persona-first-chat
					[identity]="identity"
					[provenance]="provenance"
					[transcript]="transcript"
					[currentQuestion]="currentQuestion"
					[state]="state"
					[statusMessage]="statusMessage"
					[completionMessage]="completionMessage"
					[draftAnswer]="draftAnswer"
					(draftAnswerChange)="draftAnswer = $event"
					(answerSubmitted)="submittedAnswer = $event.answer"
					(retryRequested)="retryCount = retryCount + 1"
				/>
				<output hidden data-testid="submitted-answer" [attr.data-answer]="submittedAnswer"></output>
				<output hidden data-testid="retry-count" [attr.data-count]="retryCount"></output>
			`
		};
	}
};

export default meta;

/** Local Storybook story type for the first-chat catalogue. */
type Story = StoryObj<PersonaFirstChatComponent>;

/** First canonical question with keyboard and focus interaction coverage. */
export const AwaitingCalibration: Story =
{
	tags: ["visual-test"]
};

/** Keyboard interaction keeps multiline intent distinct from answer submission. */
export const InteractionKeyboardSubmit: Story =
{
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const composer = canvas.getByRole("textbox", { name: "Your answer" });

		// 1. Compose multiline evidence so Shift+Enter is proven to remain ordinary text input.
		await userEvent.click(composer);
		await userEvent.type(composer, "Digital public infrastructure");
		await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
		await userEvent.type(composer, "with auditable governance");
		await expect(composer).toHaveFocus();
		await expect(composer).toHaveValue("Digital public infrastructure\nwith auditable governance");

		// 2. Submit with plain Enter so the story proves the exact current-question intent contract.
		await userEvent.keyboard("{Enter}");
		await expect(canvasElement.querySelector("[data-testid='submitted-answer']")).toHaveAttribute("data-answer", "Digital public infrastructure\nwith auditable governance");
	}
};

/** Saved first answer followed by the second sequential Analyst question. */
export const AnsweredProgression: Story =
{
	tags: ["visual-test"],
	args:
	{
		transcript:
		[
			..._ANALYST_OPENING,
			{ id: "event-question-one", role: PersonaFirstChatMessageRoles.Agent, body: _ANALYST_QUESTIONS[0].prompt },
			{ id: "event-answer-one", role: PersonaFirstChatMessageRoles.Owner, body: "I design governed agent platforms and digital public infrastructure." }
		],
		currentQuestion: _ANALYST_QUESTIONS[1]
	}
};

/** Composer disabled while the exact current answer is being admitted. */
export const Submitting: Story =
{
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Submitting,
		draftAnswer: "Lead with a concise recommendation, then show the evidence.",
		statusMessage: "Saving answer 2 of 3…",
		currentQuestion: _ANALYST_QUESTIONS[1]
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Assert both disabled editing and live saving feedback from the supplied lifecycle state.
		await expect(canvas.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
		await expect(canvas.getByRole("status")).toHaveTextContent("Saving answer 2 of 3");
	}
};

/** Saved progression retained while the authoritative projection reloads before question three. */
export const ReconnectingResume: Story =
{
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Reconnecting,
		statusMessage: "Your two saved answers are safe. Reloading the saved conversation…",
		transcript:
		[
			..._ANALYST_OPENING,
			{ id: "event-question-one", role: PersonaFirstChatMessageRoles.Agent, body: _ANALYST_QUESTIONS[0].prompt },
			{ id: "event-answer-one", role: PersonaFirstChatMessageRoles.Owner, body: "Governed agent infrastructure." },
			{ id: "event-question-two", role: PersonaFirstChatMessageRoles.Agent, body: _ANALYST_QUESTIONS[1].prompt },
			{ id: "event-answer-two", role: PersonaFirstChatMessageRoles.Owner, body: "Recommendation first, evidence directly underneath." }
		],
		currentQuestion: _ANALYST_QUESTIONS[2]
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Verify the current ordinal and disabled composer while the saved transcript remains intact.
		await expect(canvas.getByText("Calibration question 3 of 3")).toBeInTheDocument();
		await expect(canvas.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
		await expect(canvas.getByLabelText("Saved conversation transcript").children).toHaveLength(5);
	}
};

/** Long provenance, transcript, and question content at the supported narrow viewport. */
export const NarrowLongContent: Story =
{
	tags: ["visual-test"],
	args:
	{
		identity:
		{
			..._ANALYST_IDENTITY,
			name: "De nauwkeurige en bewijsgerichte analist",
			initials: "DA"
		},
		provenance:
		{
			personaRevision: "persona-revision-with-a-deliberately-long-auditable-reference-017",
			scriptLabel: "Analist eerste-sessie kalibratiescript",
			scriptRevision: "bootstrap-analyst-reviewed-source-revision-001"
		},
		transcript:
		[
			{ id: "localized-opening", role: PersonaFirstChatMessageRoles.Agent, body: "Ik maak onzekerheid expliciet, scheid bewijs van gevolgtrekking en geef eerst de beslissingsrelevante samenvatting." },
			{ id: "localized-answer", role: PersonaFirstChatMessageRoles.Owner, body: "Ik werk aan verantwoordelijke digitale infrastructuur voor organisaties met complexe bevoegdheidsgrenzen." }
		],
		currentQuestion: { id: "localized-question", ordinal: 3, prompt: "Welke standaarden, officiële bronnen of gereviewde referenties moet ik als gezaghebbend behandelen binnen jouw vakgebied?" }
	}
};

/** Authority-confirmed terminal state with no editable composer. */
export const Completed: Story =
{
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Completed,
		currentQuestion: null,
		completionMessage: "Your three answers remain ordinary conversation evidence unless you explicitly review and retain a candidate preference."
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Confirm terminal presentation comes only from supplied state and removes answer entry.
		await expect(canvas.getByRole("status")).toHaveTextContent("Calibration complete");
		await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
	}
};

/** Recoverable failure retains transcript and emits retry intent without local recovery logic. */
export const Error: Story =
{
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Error,
		statusMessage: "Your saved transcript is unchanged. Retry when the conversation authority is available.",
		currentQuestion: _ANALYST_QUESTIONS[1]
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Emit retry intent without simulating or owning a recovery transition in the component.
		await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
		await expect(canvasElement.querySelector("[data-testid='retry-count']")).toHaveAttribute("data-count", "1");
	}
};
