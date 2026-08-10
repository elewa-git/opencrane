import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PersonaColours, PersonaModifiers, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds } from "@opencrane/state/onboarding";

import { PersonaInterviewStateComponent } from "./states/interview/persona-interview-state.component";
import { PersonaReadyStateComponent } from "./states/ready/persona-ready-state.component";
import { PersonaResolutionStateComponent } from "./states/resolution/persona-resolution-state.component";
import { PersonaResultEvidenceComponent } from "./states/result/persona-result-evidence.component";
import { PersonaReviewStateComponent } from "./states/review/persona-review-state.component";

/** Frozen reviewed question used by the feature-state catalogue. */
const _QUESTION = { id: "q1", category: "pace", prompt: "When the decision is consequential and the available evidence is incomplete, how should your agent help you move forward?", ordinal: 1, choices: [{ id: "recommend", label: "Lead with the strongest recommendation, then explain the uncertainty and the best alternative.", ordinal: 1 }, { id: "context", label: "Build the context first and wait for me to choose the direction.", ordinal: 2 }], selectedChoiceId: null } as const;

/** Build one authoritative snapshot for a canonical state-component story. */
function _Snapshot(overrides: Partial<PersonaOnboardingSnapshot> = {}): PersonaOnboardingSnapshot
{
	return {
		state: PersonaOnboardingStates.Interview,
		interviewId: "interview-1",
		answeredQuestionCount: 4,
		questionCount: 10,
		personaRevisionId: null,
		questions: [_QUESTION],
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
		questions: [{ ..._QUESTION, selectedChoiceId: "recommend" }],
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

/** Active interview with long reviewed content and resumed durable progress. */
export const Interview: Story = {
	tags: ["visual-test"],
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
	render: function render()
	{
		return { props: { snapshot: _Snapshot(), busy: false, actionError: "The answer was not recorded. Your previous answers remain saved." }, template: `<wo-persona-interview-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Busy interview disables duplicate command admission while retaining the current question. */
export const InterviewBusy: Story = {
	tags: ["visual-test"],
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

/** Explicit tie evidence is rendered only by the resolution state component. */
export const Resolution: Story = {
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { snapshot: _Snapshot({ state: PersonaOnboardingStates.Resolution, answeredQuestionCount: 10, resolution: { kind: PersonaResolutionKinds.Primary, candidates: [PersonaColours.Blue, PersonaColours.Green] } }), busy: false, actionError: null }, template: `<wo-persona-resolution-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const choice = canvas.getByRole("radio", { name: "Blue" });
		await userEvent.click(choice);
		await expect(choice).toBeChecked();
	}
};

/** Immutable draft and its evidence are rendered by the review state component. */
export const Review: Story = {
	tags: ["visual-test"],
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
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Review), busy: false, actionError: null }, template: `<wo-persona-review-state [snapshot]="snapshot" [busy]="busy" [actionError]="actionError" />` };
	}
};

/** Approved immutable evidence is rendered without review-only controls. */
export const Ready: Story = {
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { snapshot: _ResultSnapshot(PersonaOnboardingStates.Ready) }, template: `<wo-persona-ready-state [snapshot]="snapshot" />` };
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

/** Shared evidence component remains independently reviewable by the visual catalogue. */
export const ResultEvidence: Story = {
	tags: ["visual-test"],
	render: function render()
	{
		const snapshot = _ResultSnapshot(PersonaOnboardingStates.Review);
		return { props: { result: snapshot.result, questions: snapshot.questions }, template: `<wo-persona-result-evidence [result]="result" [questions]="questions" />` };
	}
};
