/** Safe outcomes shared by personal and managed-service connection writes. */
const _RESPONSES = {
	202: { description: "The exact connection command is saved. Its safe status may remain pending while custody or discovery completes.", content: { "application/json": { schema: { $ref: "#/components/schemas/McpConnectionProjection" } } } },
	400: { description: "The connection command is invalid.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
	404: { description: "The connection is unavailable to this caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
	409: { description: "The command conflicts with saved connection work.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
} as const;

/** Exact body accepted only by connection activation commands. */
const _BODY = { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/McpConnectionCommand" } } } } as const;

/** Server identifier resolved to an exact current installation by the protected route. */
const _SERVER = { name: "serverId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } } as const;

/** Managed assistant whose current internal Principal owns the connection. */
const _SERVICE = { name: "agentServiceId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } } as const;

/** Caller key binding a repeated revocation to the same saved generation. */
const _REVOKE = { name: "commandId", in: "query", required: true, schema: { type: "string", minLength: 8, maxLength: 128 } } as const;

/** Prevents a delayed revoke from selecting a newer connection generation. */
const _EXPECTED_GENERATION = { name: "expectedGeneration", in: "query", required: true, description: "Connection generation the caller intends to revoke. An identical retry must retain this value.", schema: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } as const;

/** Protected write-only connection commands; reads remain on the existing installed-tool projection. */
export const _McpConnectionOpenapiPaths = {
	"/mcp/installed/{serverId}/connection": {
		put: {
			operationId: "activatePersonalMcpConnection",
			summary: "Activate or replace the calling person's exact MCP connection",
			tags: ["MCP Operator"], parameters: [_SERVER], requestBody: _BODY, responses: _RESPONSES,
		},
		delete: {
			operationId: "revokePersonalMcpConnection",
			summary: "Revoke the calling person's connection before credential cleanup",
			tags: ["MCP Operator"], parameters: [_SERVER, _REVOKE, _EXPECTED_GENERATION], responses: _RESPONSES,
		},
	},
	"/mcp/servers/{serverId}/service-connections/{agentServiceId}": {
		put: {
			operationId: "activateServiceMcpConnection",
			summary: "Activate the managed assistant's exact connection with current organisation administration",
			tags: ["MCP Operator"], parameters: [_SERVER, _SERVICE], requestBody: _BODY, responses: _RESPONSES,
		},
		delete: {
			operationId: "revokeServiceMcpConnection",
			summary: "Revoke the managed assistant's connection with current organisation administration",
			tags: ["MCP Operator"], parameters: [_SERVER, _SERVICE, _REVOKE, _EXPECTED_GENERATION], responses: _RESPONSES,
		},
	},
} as const;
