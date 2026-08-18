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

/**
 * The two chip styles: outlined, or softly filled.
 *
 * Both take their colour from {@link ScopeChipTones}; this only chooses whether the colour appears as
 * a border or as a background.
 */
export enum ScopeChipAppearances
{
	/** Transparent chip with a visible semantic outline. */
	Outlined = "outlined",
	/** Soft semantic fill with no strong border. */
	Soft = "soft"
}

/**
 * The spacing and type scale a chip uses without changing its semantic meaning.
 *
 * Density is an in-memory presentation choice. Consumers may use `Regular` in readable directory
 * rows and keep `Compact` for dense metadata; neither state carries status or access authority.
 */
export enum ScopeChipDensities
{
	/** Keeps the original small label treatment for dense metadata. */
	Compact = "compact",
	/** Adds room and a larger type size for status labels in ordinary rows. */
	Regular = "regular"
}
