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

/** One single-value field that differs between two revisions, with its rendered before and after. */
export interface RevisionScalarChange
{
	/** Structured configuration field that changed. */
	readonly field: string;
	/** Rendered value in the base revision, or null when absent. */
	readonly before: string | null;
	/** Rendered value in the target revision, or null when absent. */
	readonly after: string | null;
}

/** One collection field that differs between two revisions. Members are rendered as stable keys so an unchanged member never appears as both added and removed. */
export interface RevisionSetChange
{
	/** Structured configuration collection that changed. */
	readonly field: string;
	/** Member keys present only in the target revision, sorted. */
	readonly added: readonly string[];
	/** Member keys present only in the base revision, sorted. */
	readonly removed: readonly string[];
}

/** Which kind of power a revision change broadened: knowledge scope, tools, credentials, or budget. */
export type RevisionWideningKind = "scope" | "tools" | "credentials" | "budget";

/**
 * One change that gives the agent more power than the base revision had.
 *
 * A publication flow must surface every one of these and get explicit confirmation. `detail` is
 * human-readable and safe to show — it names references, never secret values.
 * @see {@link __DiffAgentRevisions}
 */
export interface RevisionWidening
{
	/** Category of authority that broadened. */
	readonly kind: RevisionWideningKind;
	/** Configuration field that broadened. */
	readonly field: string;
	/** Human-readable explanation of the widening. */
	readonly detail: string;
}

/** Everything that differs between two revisions. Check `widenings` first: it is the only field that indicates a security review is needed. */
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
