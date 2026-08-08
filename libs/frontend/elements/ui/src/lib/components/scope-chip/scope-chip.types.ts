/** Semantic colour treatments for compact labels and statuses. */
export enum ScopeChipTones
{
	/** Quiet metadata without a stronger status meaning. */
	Neutral = "neutral",
	/** Informational metadata or an ordinary active state. */
	Info = "info",
	/** Successful, published, or healthy state. */
	Success = "success",
	/** Pending or cautionary state that needs attention. */
	Warning = "warning",
	/** Failed, denied, or destructive state. */
	Danger = "danger",
	/** Organisation-wide knowledge scope. */
	Organization = "organization",
	/** Department knowledge scope. */
	Department = "department",
	/** Project knowledge scope. */
	Project = "project",
	/** Personal knowledge scope. */
	Personal = "personal"
}

/** Finite visual treatments for a scope chip's boundary and fill. */
export enum ScopeChipAppearances
{
	/** Transparent chip with a visible semantic outline. */
	Outlined = "outlined",
	/** Soft semantic fill with no strong border. */
	Soft = "soft"
}
