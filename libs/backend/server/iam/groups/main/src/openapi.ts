/** Build one standard JSON response entry. */
function _Response(description: string, schema: object)
{
	return { description, content: { "application/json": { schema } } };
}

/** Publishes the group response and mutation schemas through the aggregated OpenAPI document. */
export const _GroupsOpenapiSchemas = {
	Group: {
		type: "object" as const,
		required: ["id", "siloId", "name", "parentId", "membershipAuthority", "members", "memberCount"],
		properties: {
			id: { type: "string" },
			siloId: { type: "string" },
			name: { type: "string" },
			parentId: { type: "string", nullable: true, description: "Parent group identifier, or null for a hierarchy root." },
			membershipAuthority: { type: "string", enum: ["external", "local"] },
			description: { type: "string" },
			members: { type: "array", items: { type: "string" } },
			memberCount: { type: "integer" },
		},
	},
	GroupMutationResponse: {
		type: "object" as const,
		required: ["id", "status"],
		properties: { id: { type: "string" }, status: { type: "string", enum: ["created", "updated", "deleted"] } },
	},
};

/** Group create request with immutable membership provenance. */
const _GROUP_CREATE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["name", "membershipAuthority"],
	properties: {
		name: { type: "string", minLength: 1 },
		membershipAuthority: { type: "string", enum: ["external", "local"] },
		parentId: { type: "string", minLength: 1, nullable: true },
		description: { type: "string" },
		members: { type: "array", items: { type: "string", minLength: 1 }, description: "Direct Principal IDs; rejected for externally managed groups." },
	},
};

/** Group update request that cannot change membership provenance. */
const _GROUP_UPDATE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		name: { type: "string", minLength: 1 },
		parentId: { type: "string", minLength: 1, nullable: true },
		description: { type: "string" },
		members: { type: "array", items: { type: "string", minLength: 1 }, description: "Replacement direct Principal IDs for a locally managed group." },
	},
};

/** Documents the silo-bound group management routes. */
export const _GroupsOpenapiPaths = {
	"/groups": {
		get: { operationId: "listGroups", summary: "List groups in the authenticated silo", tags: ["Groups"], responses: { 200: _Response("Group list.", { type: "array", items: { $ref: "#/components/schemas/Group" } }) } },
		post: { operationId: "createGroup", summary: "Create a group", tags: ["Groups"], requestBody: { required: true, content: { "application/json": { schema: _GROUP_CREATE_SCHEMA } } }, responses: { 201: _Response("Group created.", { $ref: "#/components/schemas/GroupMutationResponse" }), 400: _Response("Invalid group request.", { $ref: "#/components/schemas/Error" }), 404: _Response("Parent or principal not found in this silo.", { $ref: "#/components/schemas/Error" }), 409: _Response("Group conflict.", { $ref: "#/components/schemas/Error" }) } },
	},
	"/groups/{id}": {
		get: { operationId: "getGroup", summary: "Get a group in the authenticated silo", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: _Response("Group detail.", { $ref: "#/components/schemas/Group" }), 404: _Response("Group not found.", { $ref: "#/components/schemas/Error" }) } },
		put: { operationId: "updateGroup", summary: "Update a group", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: _GROUP_UPDATE_SCHEMA } } }, responses: { 200: _Response("Group updated.", { $ref: "#/components/schemas/GroupMutationResponse" }), 400: _Response("Invalid group request.", { $ref: "#/components/schemas/Error" }), 404: _Response("Group reference not found.", { $ref: "#/components/schemas/Error" }), 409: _Response("Group hierarchy or membership-authority conflict.", { $ref: "#/components/schemas/Error" }) } },
		delete: { operationId: "deleteGroup", summary: "Delete a group", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: _Response("Group deleted.", { $ref: "#/components/schemas/GroupMutationResponse" }), 404: _Response("Group not found.", { $ref: "#/components/schemas/Error" }), 409: _Response("Group still has active references.", { $ref: "#/components/schemas/Error" }) } },
	},
};
