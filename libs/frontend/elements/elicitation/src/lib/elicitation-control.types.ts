import type { ElicitationApprovalScopes } from "@opencrane/contracts";

/** One bounded option already admitted by the server-facing feature boundary. */
export interface ElicitationControlChoice
{
	/** Stable opaque selection value. */
	readonly value: string;
	/** Participant-facing label. */
	readonly label: string;
	/** Optional bounded consequence or explanation. */
	readonly description?: string;
}

/**
 * Shows who owns the execution connection and how its credentials are used.
 *
 * The feature supplies reviewed display text; this element cannot infer either value from the
 * participant making the decision. These labels grant no permission and contain no credentials.
 * Called by: `ElicitationApprovalComponent` through `ElicitationApprovalPresentation`.
 */
export interface ElicitationExecutionConnectionPresentation
{
	/** Names the connection owner without exposing identity or credential coordinates. */
	readonly owner: string;
	/** Explains whether execution uses credentials and whose credential policy applies. */
	readonly credentialUse: string;
}

/** Presentational disclosure for one consequential action. */
export interface ElicitationApprovalPresentation
{
	/** Participant-facing question. */
	readonly prompt: string;
	/** Exact action being considered. */
	readonly action: string;
	/** Display-safe target. */
	readonly target: string;
	/** Plain-language data use. */
	readonly dataUse: string;
	/** Exact display-safe proposal arguments, or null when approval must remain unavailable. */
	readonly proposedArguments?: Readonly<Record<string, unknown>> | null;
	/** Optional external system label. */
	readonly externalSystem?: string;
	/** Shows connection ownership separately from the participant choosing a response. */
	readonly executionConnection?: ElicitationExecutionConnectionPresentation;
	/** Plain-language consequence. */
	readonly consequence: string;
	/** Optional cost disclosure. */
	readonly cost?: string;
	/** Scopes the server will accept for this question. Absent or empty means only a one-off answer. */
	readonly offeredScopes?: readonly ElicitationApprovalScopes[];
}

/** Presentational single-choice question. */
export interface ElicitationSingleChoicePresentation
{
	/** Participant-facing question. */
	readonly prompt: string;
	/** Ordered admitted options. */
	readonly choices: readonly ElicitationControlChoice[];
}

/** Presentational bounded multiple-choice question. */
export interface ElicitationMultipleChoicePresentation extends ElicitationSingleChoicePresentation
{
	/** Minimum accepted selections. */
	readonly minimumSelections: number;
	/** Maximum accepted selections. */
	readonly maximumSelections: number;
}

/** Presentational bounded free-text question. */
export interface ElicitationFreeTextPresentation
{
	/** Participant-facing question. */
	readonly prompt: string;
	/** Browser-enforced character limit. */
	readonly maximumLength: number;
}

/**
 * One approval answer: the decision, plus how long it should hold.
 *
 * The scope travels with the decision rather than in a separate control, because the person picks
 * both in one click — "Allow every time" is a single answer, not an approval plus a setting.
 */
export interface ElicitationApprovalDraft
{
	/** Whether the action was allowed. */
	readonly approved: boolean;
	/** How long the answer holds. A denial is always one-off. */
	readonly scope: ElicitationApprovalScopes;
}
