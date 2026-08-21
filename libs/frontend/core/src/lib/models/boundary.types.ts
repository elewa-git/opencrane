/** Resource boundary kinds rendered across context, skills, datasets, and ledger evidence. */
export enum ResourceBoundaryKind
{
	/** A stored IAM group; its name and parent hierarchy come from group data. */
	Group = "group",
	/** The exact boundary owned by one principal. */
	Personal = "personal"
}

/** Boundary accent colour per kind. */
export const BOUNDARY_COLORS: Record<ResourceBoundaryKind, string> =
{
	[ResourceBoundaryKind.Group]: "#5A8A5A",
	[ResourceBoundaryKind.Personal]: "#C84B31"
};
