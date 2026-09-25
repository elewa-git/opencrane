/** Reusable JSON error response emitted by the authenticated spend routes. */
const _ErrorResponse = {
	description: "The authenticated Principal is not authorised or the spend operation failed.",
	content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

/** Error response returned when Express rejects malformed JSON before the route runs. */
const _MalformedJsonResponse = {
	description: "The request body contained malformed JSON.",
	content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

/** Reusable successful JSON response helper for spend paths. */
function _jsonResponse(description: string, schema: object)
{
	return {
		description,
		content: { "application/json": { schema } },
	};
}

/** Component schemas owned by the spend domain and registered by the aggregate API spec. */
export const _SpendOpenapiSchemas = {
	Budget: {
		type: "object" as const,
		additionalProperties: false,
		required: ["currency", "ceilingAmount"],
		properties: {
			currency: { type: "string" as const, description: "ISO currency code stored with the ceiling." },
			ceilingAmount: { type: "number" as const, description: "Monthly spend ceiling in the stated currency." },
		},
	},
	AccountBudget: {
		type: "object" as const,
		additionalProperties: false,
		required: ["userId", "currency", "ceilingAmount"],
		properties: {
			userId: { type: "string" as const, description: "Account whose ceiling is configured." },
			currency: { type: "string" as const, description: "ISO currency code stored with the ceiling." },
			ceilingAmount: { type: "number" as const, description: "Monthly spend ceiling in the stated currency." },
		},
	},
	TokenUsage: {
		type: "object" as const,
		additionalProperties: false,
		required: ["userId", "inputTokens", "outputTokens", "totalTokens", "currency", "totalCost"],
		properties: {
			userId: { type: "string" as const, description: "Account whose usage was sampled." },
			inputTokens: { type: "integer" as const, description: "Input tokens counted in the snapshot." },
			outputTokens: { type: "integer" as const, description: "Output tokens counted in the snapshot." },
			totalTokens: { type: "integer" as const, description: "Combined input and output token count." },
			currency: { type: "string" as const, description: "Currency used for the recorded cost." },
			totalCost: { type: "number" as const, description: "Provider cost recorded for the snapshot." },
			budgetCeiling: { type: "number" as const, description: "Effective account or global ceiling in the same currency, when configured." },
		},
	},
} as const;

/** Request body accepted by the existing budget write handlers. */
const _BudgetWriteSchema = {
	type: "object" as const,
	properties: {
		currency: { type: "string" as const, default: "USD", description: "ISO currency code; defaults to USD when omitted." },
		ceilingAmount: { type: "number" as const, default: 0, description: "Monthly spend ceiling in the stated currency; defaults to 0 when omitted." },
	},
};

/** Describes spend routes for the server's OpenAPI document. */
export const _SpendOpenapiPaths = {
	"/ai-budget/global": {
		get: {
			operationId: "getGlobalBudget",
			summary: "Get the global spend ceiling",
			tags: ["AI Budget"],
			responses: {
				200: _jsonResponse("Global budget.", { $ref: "#/components/schemas/Budget" }),
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
		put: {
			operationId: "updateGlobalBudget",
			summary: "Update the global spend ceiling",
			tags: ["AI Budget"],
			requestBody: {
				required: true,
				content: { "application/json": { schema: _BudgetWriteSchema } },
			},
			responses: {
				204: { description: "Global budget updated; the response has no body." },
				400: _MalformedJsonResponse,
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
	},

	"/ai-budget/accounts": {
		get: {
			operationId: "listAccountBudgets",
			summary: "List per-account spend ceilings",
			tags: ["AI Budget"],
			responses: {
				200: _jsonResponse("Account budgets.", { type: "array", items: { $ref: "#/components/schemas/AccountBudget" } }),
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
	},

	"/ai-budget/accounts/{userId}": {
		put: {
			operationId: "upsertAccountBudget",
			summary: "Create or update an account spend ceiling",
			tags: ["AI Budget"],
			parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: { "application/json": { schema: _BudgetWriteSchema } },
			},
			responses: {
				204: { description: "Account budget updated; the response has no body." },
				400: _MalformedJsonResponse,
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
		delete: {
			operationId: "deleteAccountBudget",
			summary: "Remove an account spend ceiling",
			tags: ["AI Budget"],
			parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
			responses: {
				204: { description: "Account budget removed; the response has no body." },
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
	},

	"/token-usage": {
		get: {
			operationId: "listTokenUsage",
			summary: "List authorised token usage",
			tags: ["Token usage"],
			responses: {
				200: _jsonResponse("Authorised token-usage rows.", { type: "array", items: { $ref: "#/components/schemas/TokenUsage" } }),
				403: _ErrorResponse,
				500: _ErrorResponse,
			},
		},
	},
} as const;
