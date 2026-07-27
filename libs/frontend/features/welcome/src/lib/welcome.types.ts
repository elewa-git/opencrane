/**
 * Ordered steps of the operator first-run onboarding.
 *
 * Enum-first UI state: the page maps the current step to a heading, a panel,
 * and the PrimeNG Stepper position with a `switch`/lookup rather than magic
 * numbers. Numeric values are 1-based so they double as the Stepper `value`.
 *
 * Distinct from the opencrane-ui signup funnel (`features/onboarding`): this
 * flow greets an already-authenticated user landing in the operator app for the
 * first time and never writes to the control plane.
 */
export enum WelcomeStep
{
	/** Greet the user by name and state the one-line value proposition. */
	Welcome = 1,
	/** Surface the user's governed personal-agent workspace. */
	Workspace = 2,
	/** Capture light, local-only personalisation (e.g. preferred name). */
	Personalize = 3,
	/** A three-card tour of the workspace, context panel, and settings. */
	Tour = 4,
	/** Confirm, mark onboarding complete, and hand off to the workspace. */
	Finish = 5
}

/**
 * Local-only personalisation captured on the Personalize step.
 *
 * Held in a component signal and never sent to the control plane today; this is
 * the shape user preferences will persist with once a `/preferences` (or
 * equivalent) endpoint lands — see {@link WelcomePageComponent.personalization}.
 */
export interface WelcomePersonalization
{
	/** Preferred display name the user would like the workspace to greet them by. */
	preferredName: string;
}

/**
 * A single card on the Quick tour step.
 *
 * Pure presentational data (no behaviour), rendered with `@for`; the tour is a
 * fixed catalogue defined in `welcome.util.ts`.
 */
export interface WelcomeTourCard
{
	/** Stable key used as the `@for` track expression. */
	id: string;
	/** Short card heading (e.g. "Your workspace"). */
	title: string;
	/** One- or two-sentence description of the area being introduced. */
	description: string;
}
