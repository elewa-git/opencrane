/** Refuses a changed command that attempts to reuse an already admitted retry key. */
export class GroupChildConflictError extends Error
{
	/** Uses a fixed public-safe reason without exposing the conflicting command. */
	public constructor() { super("group_child_command_conflict"); }
}
