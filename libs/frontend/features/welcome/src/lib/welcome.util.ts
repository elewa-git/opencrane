import { WelcomePersonalization, WelcomeStep, WelcomeTourCard } from "./welcome.types";

/** Steps in display order; the single source of truth for advance/back. */
export const _WELCOME_STEPS: readonly WelcomeStep[] =
[
	WelcomeStep.Welcome,
	WelcomeStep.Workspace,
	WelcomeStep.Personalize,
	WelcomeStep.Tour,
	WelcomeStep.Finish
];

/** An empty personalisation snapshot, used to seed the page's signal. */
export const _EMPTY_PERSONALIZATION: WelcomePersonalization =
{
	preferredName: ""
};

/** The fixed catalogue of Quick tour cards, rendered on the Tour step. */
export const _WELCOME_TOUR_CARDS: readonly WelcomeTourCard[] =
[
	{
		id: "workspace",
		title: "Your workspace",
		description: "Chat with your governed personal agent. Conversations and runs remain owner-bound to your account."
	},
	{
		id: "context",
		title: "Context panel",
		description: "See and steer what the assistant knows — connected sources, active skills, and the awareness it draws on."
	},
	{
		id: "settings",
		title: "Settings",
		description: "Tune your pod, models and budgets, channels, and access from one place whenever you need to."
	}
];

/** Index of a step within the ordered flow (−1 when not a flow step). */
export function _StepIndex(step: WelcomeStep): number
{
	return _WELCOME_STEPS.indexOf(step);
}

/**
 * The next step after `current`, or `current` itself when already at the end.
 *
 * Pure; the page advances unconditionally (every step is informational or
 * local-only), so there is no per-step gate as in the signup funnel.
 */
export function _NextStep(current: WelcomeStep): WelcomeStep
{
	const index = _StepIndex(current);
	if (index < 0 || index >= _WELCOME_STEPS.length - 1)
	{
		return current;
	}
	return _WELCOME_STEPS[index + 1];
}

/** The previous step before `current`, or `current` itself when already first. */
export function _PreviousStep(current: WelcomeStep): WelcomeStep
{
	const index = _StepIndex(current);
	if (index <= 0)
	{
		return current;
	}
	return _WELCOME_STEPS[index - 1];
}

/** Whether `current` is the first flow step (drives the disabled Back button). */
export function _IsFirstStep(current: WelcomeStep): boolean
{
	return _StepIndex(current) === 0;
}

/** Whether `current` is the final flow step (drives the Finish CTA). */
export function _IsLastStep(current: WelcomeStep): boolean
{
	return _StepIndex(current) === _WELCOME_STEPS.length - 1;
}
