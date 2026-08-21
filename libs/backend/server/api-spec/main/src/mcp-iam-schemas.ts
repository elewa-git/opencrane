/** MCP operator access and explicit resource-sharing OpenAPI components. */
export const _McpIamOpenapiSchemas = {
	McpCatalogServer: {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, publisher: { type: "string" }, glyph: { type: "string" },
			type: { type: "string", enum: ["single-user", "multi-user", "remote-oauth"] },
			approvalStatus: { type: "string", enum: ["pending-review", "approved", "published", "disabled"] },
			credentialSchema: { type: "array", items: { $ref: "#/components/schemas/CredentialField" } },
			entitlementSummary: { type: "string" },
		},
	},
	CredentialField: {
		type: "object",
		required: ["key", "label", "required", "sensitive"],
		properties: { key: { type: "string" }, label: { type: "string" }, required: { type: "boolean" }, sensitive: { type: "boolean" }, placeholder: { type: "string" }, hint: { type: "string" } },
	},
	McpInstalled: {
		type: "object",
		required: ["serverId"],
		properties: { serverId: { type: "string" }, connectionStatus: { type: "string", enum: ["needs-credential", "shared-key"] }, lastUsed: { type: ["string", "null"], format: "date-time" } },
	},
	EntitledUser: {
		type: "object",
		required: ["id", "name", "initials", "color"],
		properties: { id: { type: "string", description: "Stable local Principal identifier." }, name: { type: "string" }, initials: { type: "string" }, color: { type: "string" } },
	},
	EntitledGroup: {
		type: "object",
		required: ["id", "name"],
		properties: { id: { type: "string", description: "Stable local Group identifier." }, name: { type: "string", description: "Display data; authorization uses the identifier." } },
	},
	McpAccessPolicy: {
		type: "object",
		required: ["serverId", "groups", "users"],
		properties: { serverId: { type: "string" }, groups: { type: "array", items: { $ref: "#/components/schemas/EntitledGroup" } }, users: { type: "array", items: { $ref: "#/components/schemas/EntitledUser" } } },
	},
	McpDirectory: {
		type: "object",
		required: ["users", "groups"],
		properties: { users: { type: "array", items: { $ref: "#/components/schemas/EntitledUser" } }, groups: { type: "array", items: { $ref: "#/components/schemas/EntitledGroup" } } },
	},
	ResourceShare: {
		type: "object",
		description: "A direct file/chat/dataset share backed by explicit recipients and authorization grants.",
		required: ["id", "resourceType", "resourceId", "ownerPrincipalId", "recipientPrincipalIds"],
		properties: { id: { type: "string" }, resourceType: { type: "string", enum: ["file", "chat", "dataset"] }, resourceId: { type: "string" }, ownerPrincipalId: { type: "string" }, recipientPrincipalIds: { type: "array", items: { type: "string" } } },
	},
} as const;
