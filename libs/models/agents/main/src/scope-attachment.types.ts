/** Canonical organisational scope vocabulary shared with the grant compiler (`GrantScope`). */
export type GrantScope = "org" | "department" | "team" | "project" | "personal";

/** Canonical principal-type vocabulary shared with the grant compiler (`GrantSubjectType`). */
export type GrantSubjectType = "group" | "tenant" | "user";

/**
 * One revision-scoped scope attachment declared on an immutable agent revision.
 *
 * An attachment authorises the managed agent to read/recall and inject/write knowledge for that
 * exact scope and target only; it never implies access to a parent, peer, personal, or
 * organisation-wide scope, and it never grants skills, MCP tools, models, credentials, or
 * administrative permissions — those remain independently grant-compiled. The shape is the same
 * `{ scope, subjectType, subjectId }` triple the grant compiler resolves.
 */
export interface RevisionScopeAttachment
{
	/** Canonical containment scope the attachment targets. */
	readonly scope: GrantScope;
	/** Canonical principal type the attachment targets. */
	readonly subjectType: GrantSubjectType;
	/** Identifier meaningful within the selected scope and principal type. */
	readonly subjectId: string;
}
