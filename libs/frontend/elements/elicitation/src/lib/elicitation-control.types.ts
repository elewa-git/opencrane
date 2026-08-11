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
	/** Optional external system label. */
	readonly externalSystem?: string;
	/** Plain-language consequence. */
	readonly consequence: string;
	/** Optional cost disclosure. */
	readonly cost?: string;
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
