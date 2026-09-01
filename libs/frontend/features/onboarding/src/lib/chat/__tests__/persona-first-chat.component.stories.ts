import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { PersonaArchetypeTones } from "@opencrane/elements/ui";

import { PersonaFirstChatComponent } from "../persona-first-chat.component";
import { type PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, PersonaFirstChatStates, type PersonaFirstChatTranscriptMessage } from "../persona-first-chat.types";

/** Stable personal-agent identity shared by canonical Commander stories. */
const _COMMANDER_IDENTITY: PersonaFirstChatIdentity =
{
	name: "The Commander (Guardian)",
	initials: "TC",
	archetype: PersonaArchetypeTones.Commander
};

/** Exact reviewed references exposed in the canonical Commander stories. */
const _COMMANDER_PROVENANCE: PersonaFirstChatProvenance =
{
	personaRevision: "persona-r17",
	scriptLabel: "docs/design/persona-archetypes/bootstrap-commander.md",
	scriptRevision: "bootstrap-commander-v1"
};

/** Commander opening emitted before the first sequential calibration question. */
const _COMMANDER_OPENING: readonly PersonaFirstChatTranscriptMessage[] =
[
	{
		id: "event-opening",
		role: PersonaFirstChatMessageRoles.Agent,
		body: `I'm your personal assistant. Based on your onboarding answers, I'm set up to be direct,
concise, and results-focused. I'll give you straight answers, challenge you when I see a better
path, and skip the filler.

Before we start working: three quick things I need from you to be effective.`
	}
];

/** Canonical Commander questions in reviewed bootstrap order. */
const _COMMANDER_QUESTIONS: readonly PersonaFirstChatQuestion[] =
[
	{
		id: "commander-priority",
		ordinal: 1,
		prompt: "What are you working on right now?"
	},
	{
		id: "commander-friction",
		ordinal: 2,
		prompt: "What is the one thing that wastes your time most?"
	},
	{
		id: "commander-challenge",
		ordinal: 3,
		prompt: "When I push back on your ideas, how hard should I push?"
	}
];

/** Canonical fully answered Commander transcript retained while conclusion is admitted. */
const _COMMANDER_FINISHING_TRANSCRIPT: readonly PersonaFirstChatTranscriptMessage[] =
[
	..._COMMANDER_OPENING,
	{
		id: "event-question-one",
		role: PersonaFirstChatMessageRoles.Agent,
		body: _COMMANDER_QUESTIONS[0].prompt
	},
	{
		id: "event-answer-one",
		role: PersonaFirstChatMessageRoles.Owner,
		body: "A reliable local-development workflow for the frontend."
	},
	{
		id: "event-question-two",
		role: PersonaFirstChatMessageRoles.Agent,
		body: _COMMANDER_QUESTIONS[1].prompt
	},
	{
		id: "event-answer-two",
		role: PersonaFirstChatMessageRoles.Owner,
		body: "Waiting on shared environments to verify UI changes."
	},
	{
		id: "event-question-three",
		role: PersonaFirstChatMessageRoles.Agent,
		body: _COMMANDER_QUESTIONS[2].prompt
	},
	{
		id: "event-answer-three",
		role: PersonaFirstChatMessageRoles.Owner,
		body: "Be direct and name the evidence before I commit to the wrong path."
	}
];

/** Storybook metadata for the feature-owned first-chat composition. */
const meta: Meta<PersonaFirstChatComponent> =
{
	title: "Onboarding/Persona first chat",
	component: PersonaFirstChatComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The feature presentation boundary for a reviewed first-chat calibration. It renders server-provided identity, provenance, transcript, and lifecycle state, then emits intent for the owning route to admit."
			}
		}
	},
	args:
	{
		identity: _COMMANDER_IDENTITY,
		provenance: _COMMANDER_PROVENANCE,
		transcript: _COMMANDER_OPENING,
		currentQuestion: _COMMANDER_QUESTIONS[0],
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
	parameters: { docs: { description: { story: "The initial reviewed calibration question after the agent's opening statement. It documents editable intent before any answer is sent, saved, or interpreted as a preference." } } },
	tags: ["visual-test"]
};

/** Keyboard interaction keeps multiline intent distinct from answer submission. */
export const InteractionKeyboardSubmit: Story =
{
	parameters: { docs: { description: { story: "The keyboard contract for a multiline answer: Shift+Enter remains text input and Enter emits the exact answer intent. The Storybook play test proves this component contract without performing a network transition." } } },
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

/** Saved first answer followed by the second sequential Commander question. */
export const AnsweredProgression: Story =
{
	parameters: { docs: { description: { story: "A server-projected transcript after the first answer is saved and before the second is answered. It demonstrates that sequential position follows supplied durable evidence, not local draft state." } } },
	tags: ["visual-test"],
	args:
	{
		transcript:
		[
			..._COMMANDER_OPENING,
			{
				id: "event-question-one",
				role: PersonaFirstChatMessageRoles.Agent,
				body: _COMMANDER_QUESTIONS[0].prompt
			},
			{
				id: "event-answer-one",
				role: PersonaFirstChatMessageRoles.Owner,
				body: "I design governed agent platforms and digital public infrastructure."
			}
		],
		currentQuestion: _COMMANDER_QUESTIONS[1]
	}
};

/** Composer disabled while the exact current answer is being admitted. */
export const Submitting: Story =
{
	parameters: { docs: { description: { story: "The exact current answer while admission is pending. Editing is disabled and an explicit status is announced, protecting against duplicate or conflicting local submissions." } } },
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Submitting,
		draftAnswer: "Lead with a concise recommendation, then show the evidence.",
		statusMessage: "Saving answer 2 of 3…",
		currentQuestion: _COMMANDER_QUESTIONS[1]
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
	parameters: { docs: { description: { story: "A reconnecting projection that retains two saved answers and identifies the next question. It assures the owner that transcript evidence is intact while editing waits for authoritative recovery." } } },
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Reconnecting,
		statusMessage: "Your two saved answers are safe. Reloading the saved conversation…",
		transcript:
		[
			..._COMMANDER_OPENING,
			{
				id: "event-question-one",
				role: PersonaFirstChatMessageRoles.Agent,
				body: _COMMANDER_QUESTIONS[0].prompt
			},
			{
				id: "event-answer-one",
				role: PersonaFirstChatMessageRoles.Owner,
				body: "Governed agent infrastructure."
			},
			{
				id: "event-question-two",
				role: PersonaFirstChatMessageRoles.Agent,
				body: _COMMANDER_QUESTIONS[1].prompt
			},
			{
				id: "event-answer-two",
				role: PersonaFirstChatMessageRoles.Owner,
				body: "Recommendation first, evidence directly underneath."
			}
		],
		currentQuestion: _COMMANDER_QUESTIONS[2]
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

/** All admitted answers remain visible while the server validates onboarding completion. */
export const Finishing: Story =
{
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Finishing,
		statusMessage: "Validating your completed calibration…",
		transcript: _COMMANDER_FINISHING_TRANSCRIPT,
		currentQuestion: null
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Keep admitted evidence readable while accurately naming server-owned completion work.
		await expect(canvas.getByRole("status")).toHaveTextContent("Validating your completed calibration");
		await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
		await expect(canvas.getByLabelText("Saved conversation transcript").children).toHaveLength(7);
	}
};

/** Long provenance, transcript, and question content at the supported narrow viewport. */
export const NarrowLongContent: Story =
{
	parameters: { docs: { description: { story: "Long Dutch identity, provenance, transcript, and question content at the supported narrow viewport. It protects the audit trail and question meaning from truncation in localized or high-detail use." } } },
	tags: ["visual-test"],
	args:
	{
		identity:
		{
			..._COMMANDER_IDENTITY,
			name: "De directe en resultaatgerichte commandant",
			initials: "DC"
		},
		provenance:
		{
			personaRevision: "persona-revision-with-a-deliberately-long-auditable-reference-017",
			scriptLabel: "Commandant eerste-sessie kalibratiescript",
			scriptRevision: "bootstrap-commander-reviewed-source-revision-001"
		},
		transcript:
		[
			{
				id: "localized-opening",
				role: PersonaFirstChatMessageRoles.Agent,
				body: "Ik geef eerst een directe aanbeveling, houd de uitleg beknopt en benoem risico's meteen wanneer een bewezen aanpak veiliger is."
			},
			{
				id: "localized-answer",
				role: PersonaFirstChatMessageRoles.Owner,
				body: "Ik werk aan verantwoordelijke digitale infrastructuur voor organisaties met complexe bevoegdheidsgrenzen."
			}
		],
		currentQuestion: {
			id: "localized-question",
			ordinal: 3,
			prompt: "Hoe direct moet ik tegenspreken wanneer ik denk dat jouw gekozen aanpak een belangrijk risico oplevert?"
		}
	}
};

/** Authority-confirmed terminal state with no editable composer. */
export const Completed: Story =
{
	parameters: { docs: { description: { story: "The terminal server-confirmed calibration state. The composer disappears, and the message distinguishes ordinary conversation evidence from an explicitly reviewed retained preference." } } },
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
	parameters: { docs: { description: { story: "A recoverable authority failure that preserves the existing transcript and exposes retry intent. It never invents a recovery transition in the component itself." } } },
	tags: ["visual-test"],
	args:
	{
		state: PersonaFirstChatStates.Error,
		statusMessage: "Your saved transcript is unchanged. Retry when the conversation authority is available.",
		currentQuestion: _COMMANDER_QUESTIONS[1]
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);

		// 1. Emit retry intent without simulating or owning a recovery transition in the component.
		await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
		await expect(canvasElement.querySelector("[data-testid='retry-count']")).toHaveAttribute("data-count", "1");
	}
};
