// Common response helpers
function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by the metrics domain (composed into the opencrane-ui spec). */
export const _MetricsOpenapiPaths = {
  "/metrics/server": {
    get: {
      operationId: "getServerMetrics",
      summary: "Get latest server utilisation snapshot (CPU, memory, storage, active tenants)",
      tags: ["Metrics"],
      responses: {
        200: ok("Server utilisation snapshot.", {
          type: "object",
          required: ["cpuPercent", "memoryUsedBytes", "memoryTotalBytes", "storageUsedBytes", "storageTotalBytes", "activeTenants", "sampledAt"],
          properties: {
            cpuPercent: { type: "number", description: "CPU utilisation percentage (0–100)." },
            memoryUsedBytes: { type: "integer", format: "int64" },
            memoryTotalBytes: { type: "integer", format: "int64" },
            storageUsedBytes: { type: "integer", format: "int64" },
            storageTotalBytes: { type: "integer", format: "int64" },
            activeTenants: { type: "integer" },
            sampledAt: { type: "string", format: "date-time" },
          },
        }),
      },
    },
  },

  "/metrics/projection-drift": {
    get: {
      operationId: "getProjectionDriftMetrics",
      summary: "Get projection drift metrics with threshold evaluation and alert state",
      tags: ["Metrics"],
      responses: {
        200: ok("Projection drift metrics.", { $ref: "#/components/schemas/ProjectionDrift" }),
      },
    },
  },

  "/token-usage": {
    get: {
      operationId: "listTokenUsage",
      summary: "List token usage records",
      tags: ["Token Usage"],
      parameters: [
        { name: "tenant", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
      ],
      responses: {
        200: ok("Token usage records.", { type: "array", items: { $ref: "#/components/schemas/TokenUsage" } }),
      },
    },
  },
};
