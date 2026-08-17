import { _OrganizationMembersOpenapiSchemas } from "@opencrane/backend/server/iam/organization-members";

/** Shared pagination schema consumed by domain paths. */
const _PaginationSchema = {
	type: "object" as const,
	required: ["limit", "hasMore"],
	properties: {
		limit: { type: "integer", minimum: 1, maximum: 1000 },
		nextCursor: { type: "string", description: "Opaque cursor for the next page. Absent when hasMore is false." },
		hasMore: { type: "boolean" },
	},
};

/** Collects schemas owned by domain packages and the shared API pagination contract. */
export const _DomainOpenapiSchemas = {
	Pagination: _PaginationSchema,
	..._OrganizationMembersOpenapiSchemas,
};
