import { McpConnectionFailureCodes, McpConnectionStatus } from "@opencrane/contracts";

/** Write-only commands and safe projections for exact MCP connection generations. */
export const _McpConnectionOpenapiSchemas = {
	McpConnectionCommand: {
		type: "object",
		additionalProperties: false,
		required: ["idempotencyKey", "expectedGeneration", "credential"],
		properties: {
			idempotencyKey: { type: "string", minLength: 8, maxLength: 128, description: "Caller key that returns the same admitted generation after an uncertain response." },
			expectedGeneration: { type: ["integer", "null"], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Generation observed before this command, or null before any generation. An identical retry must retain this value; a new command cannot replace a different current generation." },
			credential: {
				description: "Material matching the registered server's explicit credential requirement. The token is write-only and never appears in responses or workflow input.",
				oneOf: [
					{ type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: ["none"] } } },
					{ type: "object", additionalProperties: false, required: ["kind", "token"], properties: { kind: { type: "string", enum: ["bearer"] }, token: { type: "string", minLength: 1, maxLength: 8192, writeOnly: true, description: "Bearer token used only for the exact admitted credential custody operation." } } },
				],
			},
		},
	},
	McpConnectionProjection: {
		type: "object",
		additionalProperties: false,
		required: ["connectionStatus", "connectionGeneration", "credentialUpdatedAt", "failureCode"],
		properties: {
			connectionStatus: { type: "string", enum: Object.values(McpConnectionStatus), description: "Current connection state. Every effect independently rechecks authority and the saved generation." },
			connectionGeneration: { type: ["integer", "null"], minimum: 1, description: "Current admitted generation, or null before connection setup." },
			credentialUpdatedAt: { type: ["string", "null"], format: "date-time", description: "Time exact credential custody committed, or null when no credential was stored." },
			failureCode: { type: ["string", "null"], enum: [...Object.values(McpConnectionFailureCodes), null], description: "Safe failure category without provider responses, secret coordinates or material." },
		},
	},
} as const;
