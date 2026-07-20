// Common response helpers
function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

// Cursor-paginated response wrapper
function paginated(itemSchema: object)
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

/** OpenAPI path fragments owned by the audit domain (composed into the opencrane-ui spec). */
export const _AuditOpenapiPaths = {
  "/audit": {
    get: {
      operationId: "listAuditEntries",
      summary: "Query audit log entries with optional tenant filter and cursor pagination",
      tags: ["Audit"],
      parameters: [
        { name: "tenant", in: "query", schema: { type: "string" }, description: "Filter to a specific tenant." },
        { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 1000 }, description: "Maximum entries to return." },
        { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from a previous response for keyset pagination." },
      ],
      responses: {
        200: ok("Paginated audit entries.", paginated({ $ref: "#/components/schemas/AuditEntry" })),
      },
    },
  },
};
