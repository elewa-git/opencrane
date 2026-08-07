/** Line-level text diff between two revisions of a text field. */
export interface RevisionLineDiff
{
	/** Field the line diff was computed over. */
	readonly field: string;
	/** Lines present only in the target revision, in order. */
	readonly addedLines: readonly string[];
	/** Lines present only in the base revision, in order. */
	readonly removedLines: readonly string[];
}

/** Semantic scalar-field change between two revisions. */
export interface RevisionScalarChange
{
	/** Structured configuration field that changed. */
	readonly field: string;
	/** Rendered value in the base revision, or null when absent. */
	readonly before: string | null;
	/** Rendered value in the target revision, or null when absent. */
	readonly after: string | null;
}

/** Semantic set-field change between two revisions rendered as stable member keys. */
export interface RevisionSetChange
{
	/** Structured configuration collection that changed. */
	readonly field: string;
	/** Member keys present only in the target revision, sorted. */
	readonly added: readonly string[];
	/** Member keys present only in the base revision, sorted. */
	readonly removed: readonly string[];
}

/** Security-relevant category widened by a revision change. */
export type RevisionWideningKind = "scope" | "tools" | "credentials" | "budget";

/** One security-relevant widening flagged for reviewer attention. */
export interface RevisionWidening
{
	/** Category of authority that broadened. */
	readonly kind: RevisionWideningKind;
	/** Configuration field that broadened. */
	readonly field: string;
	/** Human-readable explanation of the widening. */
	readonly detail: string;
}

/** Complete comparison between an ordered base and target revision. */
export interface AgentRevisionDiff
{
	/** Line-level diffs for readable text fields. */
	readonly lineDiffs: readonly RevisionLineDiff[];
	/** Semantic scalar-field changes. */
	readonly scalarChanges: readonly RevisionScalarChange[];
	/** Semantic set-field changes. */
	readonly setChanges: readonly RevisionSetChange[];
	/** Security-relevant widenings the reviewer must confirm. */
	readonly widenings: readonly RevisionWidening[];
}
