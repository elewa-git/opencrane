/** Organization-wide authorization scope. */
export interface OrganizationAuthorizationScope
{
	/** Discriminator for organization-wide authorization. */
	kind: "organization";
	/** Stable organization identifier. */
	organizationId: string;
}

/** Department authorization scope within an organization. */
export interface DepartmentAuthorizationScope
{
	/** Discriminator for department authorization. */
	kind: "department";
	/** Stable organization identifier containing the department. */
	organizationId: string;
	/** Stable department identifier. */
	departmentId: string;
}

/** Team authorization scope within an organization. */
export interface TeamAuthorizationScope
{
	/** Discriminator for team authorization. */
	kind: "team";
	/** Stable organization identifier containing the team. */
	organizationId: string;
	/** Stable team identifier. */
	teamId: string;
}

/** Project authorization scope independent of department and team dimensions. */
export interface ProjectAuthorizationScope
{
	/** Discriminator for project authorization. */
	kind: "project";
	/** Stable organization identifier containing the project. */
	organizationId: string;
	/** Stable project identifier, with no implied department or team parent. */
	projectId: string;
}

/** Authorization scope for resources owned by one user's personal agent. */
export interface PersonalAuthorizationScope
{
	/** Discriminator for personal-agent authorization. */
	kind: "personal";
	/** Stable organization identifier containing the user's personal agent. */
	organizationId: string;
	/** Stable identifier of the user who owns the personal scope. */
	userId: string;
}

/** Authorization scope for an action addressed directly to a user. */
export interface DirectUserAuthorizationScope
{
	/** Discriminator for direct-user authorization. */
	kind: "direct-user";
	/** Stable organization identifier containing the addressed user. */
	organizationId: string;
	/** Stable identifier of the directly addressed user. */
	userId: string;
}

/** Every independently evaluated authorization scope dimension. */
export type AuthorizationScope =
	OrganizationAuthorizationScope
	| DepartmentAuthorizationScope
	| TeamAuthorizationScope
	| ProjectAuthorizationScope
	| PersonalAuthorizationScope
	| DirectUserAuthorizationScope;
