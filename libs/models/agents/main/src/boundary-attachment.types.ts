/** Stable boundary kinds stored on an agent revision. */
export enum RevisionBoundaryKinds
{
	/** A stored group provides the revision's knowledge boundary. */
	Group = "group",
	/** A principal's personal resources provide the revision's knowledge boundary. */
	Personal = "personal",
}

/** Stable coverage rules stored on an agent revision boundary attachment. */
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
