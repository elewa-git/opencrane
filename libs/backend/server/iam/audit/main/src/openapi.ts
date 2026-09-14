import { _AUDIT_CURSOR_MAX_LENGTH } from "./routes/audit-cursor";

/** Builds one successful JSON response description. */
function _ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** Builds the shared cursor-page response shape around a domain item schema. */
function _paginated(itemSchema: object)
{
  return {
    type: "object" as const,
    required: ["data", "pagination"],
    properties: {
      data: { type: "array", items: itemSchema },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
  };
}

/** OpenAPI schemas exported into the server's component registry. */
export const _AuditOpenapiSchemas = {
	AuditEntry: {
		type: "object",
		additionalProperties: false,
		required: ["timestamp", "action", "resource", "message"],
		properties: {
			timestamp: { type: "string", format: "date-time" },
			tenant: { type: "string" },
			action: { type: "string" },
			resource: { type: "string" },
			message: { type: "string" },
		},
	},
} as const;

/** Error response used when a caller supplies a malformed audit cursor. */
const _InvalidCursorResponse = { description: "The audit cursor is malformed or incomplete.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
/** Error response used when no authenticated Principal is available. */
const _ForbiddenResponse = { description: "An authenticated Principal is required to read audit entries.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

/** OpenAPI path fragments owned by the audit domain and composed into the server specification. */
export const _AuditOpenapiPaths = {
  "/audit": {
    get: {
      operationId: "listAuditEntries",
      summary: "Query audit log entries with cursor pagination",
      tags: ["Audit"],
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 1000 }, description: "Maximum entries to return." },
        { name: "cursor", in: "query", schema: { type: "string", maxLength: _AUDIT_CURSOR_MAX_LENGTH }, description: "Opaque cursor from a previous response for keyset pagination." },
      ],
      responses: {
        200: _ok("Paginated audit entries.", _paginated({ $ref: "#/components/schemas/AuditEntry" })),
		400: _InvalidCursorResponse,
		403: _ForbiddenResponse,
      },
    },
  },
};
