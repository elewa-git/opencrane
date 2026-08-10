import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PersonaColours, PersonaModifiers, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaQuestion, PersonaResolutionKinds } from "@opencrane/state/onboarding";

import { PersonaInterviewStateComponent } from "../states/interview/persona-interview-state.component";
import { PersonaReadyStateComponent } from "../states/ready/persona-ready-state.component";
import { PersonaResolutionStateComponent } from "../states/resolution/persona-resolution-state.component";
import { PersonaResultEvidenceComponent } from "../states/result/persona-result-evidence.component";
import { PersonaReviewStateComponent } from "../states/review/persona-review-state.component";

/** Frozen reviewed question used by the feature-state catalogue. */
const _QUESTION = { id: "q1", category: "pace", prompt: "When the decision is consequential and the available evidence is incomplete, how should your agent help you move forward?", ordinal: 1, choices: [{ id: "recommend", label: "Lead with the strongest recommendation, then explain the uncertainty and the best alternative.", ordinal: 1 }, { id: "context", label: "Build the context first and wait for me to choose the direction.", ordinal: 2 }], selectedChoiceId: null } as const;

/** Build the complete reviewed ten-question set with an exact selected-answer prefix. */
function _Questions(answeredQuestionCount: number): readonly PersonaQuestion[]
{
	return Array.from({ length: 10 }, function _Question(_value, index)
	{
		const ordinal = index + 1;
		return {
			..._QUESTION,
			id: `q${ordinal}`,
			ordinal,
			prompt: ordinal === 5 ? _QUESTION.prompt : `Reviewed collaboration preference ${ordinal}`,
			selectedChoiceId: ordinal <= answeredQuestionCount ? "recommend" : null
		};
	});
}

/** Describe the visible state, component contract, and deliberately excluded authority. */
function _StoryDescription(userState: string, contract: string, authorityBoundary: string)
{
	return { docs: { description: { story: `${userState} ${contract} ${authorityBoundary}` } } };
}

/** Build one authoritative snapshot for a canonical state-component story. */
function _Snapshot(overrides: Partial<PersonaOnboardingSnapshot> = {}): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-1",
		answeredQuestionCount: 4,
		questionCount: 10,
		personaRevisionId: null,
		questions: _Questions(4),
		resolution: null,
		result: null,
		...overrides
	};
}

/** Build reviewed or approved immutable persona evidence for the catalogue. */
function _ResultSnapshot(state: PersonaOnboardingStates.Review | PersonaOnboardingStates.Ready): PersonaOnboardingSnapshot
{
	return _Snapshot({
		state,
		answeredQuestionCount: 10,
		personaRevisionId: "revision-1",
		questions: _Questions(10),
		result: {
			displayName: "The Analyst",
			primaryColour: PersonaColours.Blue,
			secondaryColour: PersonaColours.Green,
			modifier: PersonaModifiers.Explorer,
			colourScores: { red: 2, yellow: 1, green: 3, blue: 4, total: 10 },
			opennessScores: { explorer: 6, guardian: 4, total: 10 },
			insights: ["You prefer evidence before confidence.", "You want uncertainty named without losing a recommendation.", "You keep the strongest alternative visible when decisions are consequential."],
			instructionPreview: "Lead with the evidence-backed recommendation. Separate observations from inference, name material uncertainty, and show the strongest credible alternative without diluting the decision."
		}
	});
}

/** Storybook metadata for the actual onboarding state components. */
const meta: Meta<PersonaInterviewStateComponent> = {
	title: "Features/Persona onboarding states",
	component: PersonaInterviewStateComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [PersonaInterviewStateComponent, PersonaReadyStateComponent, PersonaResolutionStateComponent, PersonaResultEvidenceComponent, PersonaReviewStateComponent] })]
};

export default meta;

/** Local Storybook story type for onboarding feature states. */
type Story = StoryObj<PersonaInterviewStateComponent>;

/** Short introduction keeps the shared journey canvas at least as tall as the desktop viewport. */
export const Introduction: Story = {
	parameters: { docs: { description: { story: "Persona sorting has not started. This short Compact journey must fill the 1705×813 viewport. The component emits a start intent but does not provision, persist, or advance onboarding." } } },
	tags: ["visual-test", "visual-test-full-viewport"],
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ interviewId: null, answeredQuestionCount: 0, questionCount: 0, questions: [] }), busy: false, actionError: null }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Active interview with long reviewed content and resumed durable progress. */
export const Interview: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("A returning owner sees the next reviewed preference with saved progress.", "The interview component renders controlled choice and progress inputs and emits only an answer intent.", "It never records an answer or selects durable progress."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot(), busy: false, actionError: null }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const choice = canvas.getByRole("radio", { name: /Lead with the strongest recommendation/ });
		await userEvent.click(choice);
		await expect(choice).toBeChecked();
	}
};

/** Failed answer command keeps the current durable screen and retryable choice visible. */
export const InterviewError: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("A failed save leaves the current preference visible with a bounded error.", "The interview component retains controlled input while its parent reports command failure.", "It never retries or advances server state itself."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot(), busy: false, actionError: "The answer was not recorded. Your previous answers remain saved." }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Busy interview disables duplicate command admission while retaining the current question. */
export const InterviewBusy: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("An admitted save disables duplicate interaction without hiding the current preference.", "The interview component maps the parent's busy input to its controls.", "It does not decide command concurrency or admission."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot(), busy: true, actionError: null }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("radio", { name: /Lead with the strongest recommendation/ })).toBeDisabled();
		await expect(canvas.getByRole("button", { name: /Save and continue/ })).toBeDisabled();
	}
};

/** Interview entry before the authority has created the durable interview. */
export const InterviewNotStarted: Story = {
	parameters: _StoryDescription("A new owner sees the reviewed interview introduction before starting.", "The interview component emits one start intent from its pre-interview branch.", "It never creates the interview or assumes that it started."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ interviewId: null, answeredQuestionCount: 0, questions: _Questions(0) }), busy: false, actionError: null }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Defensive interview branch when no unanswered question remains in an interview projection. */
export const InterviewQuestionUnavailable: Story = {
	parameters: _StoryDescription("An incomplete lifecycle transition shows a blocking missing-question message.", "The interview component fails visibly when its typed interview input has no current question.", "The production response validator rejects inconsistent answer counts before this defensive branch."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ answeredQuestionCount: 10, questions: _Questions(10) }), busy: false, actionError: null }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Explicit tie evidence is rendered only by the resolution state component. */
export const Resolution: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("A tied result asks the owner to choose from the exact server-returned candidates.", "The resolution component controls one local selection and emits a typed resolution intent.", "It never chooses a default or creates the persona draft."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ state: PersonaOnboardingStates.Resolution, answeredQuestionCount: 10, questions: _Questions(10), resolution: { kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Blue, PersonaColours.Green] } }), busy: false, actionError: null }, template: `<wo-persona-resolution-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const choice = canvas.getByRole("radio", { name: "Blue" });
		await userEvent.click(choice);
		await expect(choice).toBeChecked();
	}
};

/** Defensive resolution branch for absent tie evidence. */
export const ResolutionEvidenceUnavailable: Story = {
	parameters: _StoryDescription("Missing tie evidence blocks resolution and offers a reload intent.", "The resolution component renders its fail-closed branch and emits retry only.", "The production validator rejects a resolution state without tie evidence."),
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ state: PersonaOnboardingStates.Resolution, answeredQuestionCount: 10, questions: _Questions(10), resolution: null }), busy: false, actionError: null }, template: `<wo-persona-resolution-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		await expect(within(canvasElement).getByRole("button", { name: "Retry" })).toBeVisible();
	}
};

/** Immutable draft and its evidence are rendered by the review state component. */
export const Review: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("An owner reviews immutable persona evidence before activation.", "The review component renders evidence and controls a deliberate approval confirmation.", "It never creates, edits, or activates a persona revision."),
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Review), busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const approveButton = canvas.getByRole("button", { name: "Approve persona" });
		await expect(approveButton).toBeEnabled();
		await expect(canvas.getByText("Exact compiled instructions")).toBeVisible();
		await userEvent.click(approveButton);
		await waitFor(async function assertConfirmationVisible()
		{
			await expect(canvas.getByRole("dialog", { name: "Approve persona" })).toBeVisible();
		});
		await userEvent.click(canvas.getByRole("button", { name: "Keep reviewing" }));
		await waitFor(function assertConfirmationClosed()
		{
			expect(canvas.queryByRole("dialog", { name: "Approve persona" })).toBeNull();
		});
	}
};

/** Long review evidence remains readable on the narrow state-component layout. */
export const ReviewNarrow: Story = {
	tags: ["visual-test", "visual-test-narrow"],
	parameters: _StoryDescription("Long immutable review evidence remains usable at the supported narrow viewport.", "The review component preserves its evidence hierarchy and actions responsively.", "It never changes the reviewed material to fit the viewport."),
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Review), busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Review state while the explicit immutable draft command remains outstanding. */
export const ReviewPreparingDraft: Story = {
	parameters: _StoryDescription("Completed interview evidence offers an explicit prepare-review action.", "The review component emits a draft intent while keeping evidence read-only.", "It never creates the immutable draft from a render or loader."),
	render: function render()
	{
		return { props: { snapshot: { ..._ResultSnapshot(PersonaOnboardingStates.Review), personaRevisionId: null }, busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Defensive review state for a revision whose immutable instruction preview is missing. */
export const ReviewMissingInstructionPreview: Story = {
	parameters: _StoryDescription("A review with missing immutable instructions blocks approval.", "The review component disables activation and displays the missing-evidence boundary.", "The production validator rejects a revision without its exact instruction preview."),
	render: function render()
	{
		const snapshot = _ResultSnapshot(PersonaOnboardingStates.Review);
		return { props: { snapshot: { ...snapshot, result: snapshot.result === null ? null : { ...snapshot.result, instructionPreview: null } }, busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Review confirmation retained open as a canonical deliberate-activation state. */
export const ReviewApprovalDialogOpen: Story = {
	parameters: _StoryDescription("The owner sees the exact activation confirmation before approval.", "The review component retains immutable approval coordinates only while its dialog is open.", "It emits no activation intent until the owner confirms."),
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Review), busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Approve persona" }));
		await waitFor(async function assertConfirmationVisible()
		{
			await expect(canvas.getByRole("dialog", { name: "Approve persona" })).toBeVisible();
		});
	}
};

/** Defensive review branch for absent persona result evidence. */
export const ReviewEvidenceUnavailable: Story = {
	parameters: _StoryDescription("Missing review evidence blocks every activation action and offers retry.", "The review component renders its fail-closed evidence branch.", "The production validator rejects review state without result evidence."),
	render: function render()
	{
		return { props: { snapshot: { ..._ResultSnapshot(PersonaOnboardingStates.Review), personaRevisionId: null, result: null }, busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		await expect(within(canvasElement).getByRole("button", { name: "Retry" })).toBeVisible();
	}
};

/** Approved immutable evidence is rendered without review-only controls. */
export const Ready: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("An approved persona remains visible while the next durable route resolves.", "The ready component renders immutable evidence without review-only controls.", "It never selects or creates the next onboarding route."),
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Ready), actionError: null }, template: `<wo-persona-ready-state [snapshot]="snapshot" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await waitFor(async function assertReadyMessage()
		{
			await expect(canvas.getByRole("alert")).toBeVisible();
		});
		expect(canvas.queryByRole("button", { name: "Approve persona" })).toBeNull();
	}
};

/** Retryable route-resolution failure after persona activation. */
export const ReadyRouteError: Story = {
	parameters: _StoryDescription("An active persona remains visible when the next route cannot be resolved.", "The ready component presents the bounded parent-store error and emits retry.", "It never performs the route read or navigation."),
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Ready), actionError: "OpenCrane could not resolve the saved first-conversation route." }, template: `<wo-persona-ready-state [snapshot]="snapshot" [actionError]="actionError" />` };
	}
};

/** Defensive ready branch for absent approved persona evidence. */
export const ReadyEvidenceUnavailable: Story = {
	parameters: _StoryDescription("Missing active-persona evidence blocks continuation and offers retry.", "The ready component renders its fail-closed evidence branch.", "The production validator rejects ready state without result evidence."),
	render: function render()
	{
		return { props: { snapshot: { ..._ResultSnapshot(PersonaOnboardingStates.Ready), result: null }, actionError: null }, template: `<wo-persona-ready-state [snapshot]="snapshot" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		await expect(within(canvasElement).getByRole("button", { name: "Retry" })).toBeVisible();
	}
};

/** Shared evidence component remains independently reviewable by the visual catalogue. */
export const ResultEvidence: Story = {
	tags: ["visual-test"],
	parameters: _StoryDescription("Reviewed evidence can be inspected independently from activation controls.", "The evidence component renders the immutable result and reviewed answers only.", "It never approves, recomputes, or persists persona evidence."),
	render: function render()
	{
		const snapshot = _ResultSnapshot(PersonaOnboardingStates.Review);
		return { props: { result: snapshot.result, questions: snapshot.questions }, template: `<wo-persona-result-evidence [result]="result" [questions]="questions" />` };
	}
};
