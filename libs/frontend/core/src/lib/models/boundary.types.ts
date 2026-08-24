/**
 * Selects how the UI labels and colours a resource boundary across context, skills, datasets, and
 * ledger evidence. Context panels and ledger cards branch on this closed set, so a new kind needs
 * an explicit label and colour before those components can render it.
 */
export enum ResourceBoundaryKind
{
	/** A stored IAM group; its name and parent hierarchy come from group data. */
	Group = "group",
	/** Resources belong to one principal and never inherit a Group parent. */
	Personal = "personal"
}

/** Boundary accent colour per kind. */
export const BOUNDARY_COLORS: Record<ResourceBoundaryKind, string> =
{
	[ResourceBoundaryKind.Group]: "#5A8A5A",
	[ResourceBoundaryKind.Personal]: "#C84B31"
};
