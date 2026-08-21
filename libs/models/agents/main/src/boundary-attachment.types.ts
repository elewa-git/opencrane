/**
 * Identifies the knowledge boundary stored on an immutable agent revision.
 *
 * Revision parsers, Prisma mappers, and runtime evidence branch on these strings. Group boundaries
 * may include descendants; Personal boundaries must remain exact. Renaming a value requires a
 * migration of stored revision attachments and their serialized revision content.
 */
export enum RevisionBoundaryKinds
{
	/** A stored group provides the revision's knowledge boundary. */
	Group = "group",
	/** A principal's personal resources provide the revision's knowledge boundary. */
	Personal = "personal",
}

/**
 * Determines how far a revision attachment reaches from its stored knowledge boundary.
 *
 * The revision writer persists this value and authorization intersects it with the caller's
 * effective grants. `Descendants` applies only to a Group; parsers reject it for Personal
 * attachments. Renaming either string requires a stored-revision migration.
 */
export enum RevisionBoundaryCoverages
{
	/** The attachment covers the named boundary alone. */
	Exact = "exact",
	/** The attachment covers the named group and its stored descendants. */
	Descendants = "descendants",
}

/** One knowledge boundary attached to an immutable agent revision. */
export type RevisionBoundaryAttachment =
	| {
		/** Identifies a stored group boundary. */
		readonly boundaryKind: RevisionBoundaryKinds.Group;
		/** Stable group identifier inside the revision's silo. */
		readonly boundaryId: string;
		/** Chooses whether the attachment covers the group alone or its stored subtree. */
		readonly boundaryCoverage: RevisionBoundaryCoverages;
	}
	| {
		/** Identifies resources owned by one principal. */
		readonly boundaryKind: RevisionBoundaryKinds.Personal;
		/** Stable principal identifier that owns the personal boundary. */
		readonly boundaryId: string;
		/** Personal boundaries never have descendants. */
		readonly boundaryCoverage: RevisionBoundaryCoverages.Exact;
	};
