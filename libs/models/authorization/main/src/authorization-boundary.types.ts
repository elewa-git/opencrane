/** Stable kinds of identities that can receive an authorization grant. */
export enum AuthorizationSubjectKinds
{
	/** A group receives authority for principals with a direct stored membership. */
	Group = "group",
	/** A principal receives authority without inheriting it from another identity. */
	Principal = "principal",
}

/** Stable kinds of product boundaries that a grant can cover. */
export enum AuthorizationBoundaryKinds
{
	/** A group boundary identifies one stored node in the silo's group hierarchy. */
	Group = "group",
	/** A personal boundary identifies resources owned by one principal. */
	Personal = "personal",
}

/** Stable ways a grant can cover a stored authorization boundary. */
export enum AuthorizationBoundaryCoverages
{
	/** The grant covers the named boundary and no other boundary. */
	Exact = "exact",
	/** The grant covers the named group and groups below it in the stored hierarchy. */
	Descendants = "descendants",
}

/** A group that receives a grant through direct stored membership. */
export interface GroupAuthorizationSubject
{
	/** Identifies a group subject. */
	readonly kind: AuthorizationSubjectKinds.Group;
	/** Stable group identifier from product authority. */
	readonly groupId: string;
}

/** A person or service identity that receives a grant directly. */
export interface PrincipalAuthorizationSubject
{
	/** Identifies a principal subject. */
	readonly kind: AuthorizationSubjectKinds.Principal;
	/** Stable principal identifier from product authority. */
	readonly principalId: string;
}

/** Identity that can receive an authorization grant. */
export type AuthorizationSubject = GroupAuthorizationSubject | PrincipalAuthorizationSubject;

/** A stored group node used as an authorization boundary. */
export interface GroupAuthorizationBoundary
{
	/** Identifies a group boundary. */
	readonly kind: AuthorizationBoundaryKinds.Group;
	/** Stable group identifier from product authority. */
	readonly groupId: string;
}

/** Resources owned by one principal rather than a group hierarchy. */
export interface PersonalAuthorizationBoundary
{
	/** Identifies a personal boundary. */
	readonly kind: AuthorizationBoundaryKinds.Personal;
	/** Stable principal identifier that owns the personal boundary. */
	readonly principalId: string;
}

/** Product-authority boundary covered by a grant. */
export type AuthorizationBoundary = GroupAuthorizationBoundary | PersonalAuthorizationBoundary;

/** Persisted hierarchy evidence used to evaluate one requested boundary. */
export interface AuthorizationBoundaryContext
{
	/** Ancestors loaded from storage for the requested group, nearest parent first; personal boundaries use an empty list. */
	readonly requestedGroupAncestorIds: readonly string[];
}
