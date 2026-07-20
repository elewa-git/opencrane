// Common response helpers
function notFound(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function badRequest(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by model routing and independent of legacy Skill rows. */
export const _ModelRoutingOpenapiPaths = {
  "/model-routing/defaults": {
    get: {
      operationId: "listModelRoutingDefaults",
      summary: "List model-routing defaults",
      tags: ["Model Registry"],
      parameters: [{ name: "clusterTenant", in: "query", required: false, schema: { type: "string" }, description: "Filter to one owning ClusterTenant." }],
      responses: {
        200: ok("Model-routing default list.", { type: "array", items: { $ref: "#/components/schemas/ModelRoutingDefault" } }),
      },
    },
    put: {
      operationId: "upsertModelRoutingDefault",
      summary: "Upsert the model-routing default for a (scope, clusterTenant) pair",
      tags: ["Model Registry"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ModelRoutingDefaultWrite" } } },
      },
      responses: {
        200: ok("Model-routing default upserted.", { $ref: "#/components/schemas/ModelRoutingDefault" }),
        400: badRequest("Request body failed validation (code VALIDATION_ERROR)."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE). Global defaults are operator-only.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/model-routing/defaults/{id}": {
    get: {
      operationId: "getModelRoutingDefault",
      summary: "Get a single model-routing default by id",
      tags: ["Model Registry"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Model-routing default detail.", { $ref: "#/components/schemas/ModelRoutingDefault" }),
        404: notFound("Model routing default not found."),
      },
    },
    delete: {
      operationId: "deleteModelRoutingDefault",
      summary: "Delete a model-routing default",
      tags: ["Model Registry"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Model-routing default deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("Model routing default not found."),
      },
    },
  },

  "/model-routing/metrics": {
    get: {
      operationId: "getRoutingMetrics",
      summary: "Proxy a metrics query to the self-hosted Langfuse backend (server-side auth; non-operators scoped to their tenant)",
      tags: ["Model Registry"],
      parameters: [
        { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Langfuse v1 metrics `query` JSON, forwarded verbatim (a tenant filter is injected for non-operators)." },
      ],
      responses: {
        200: ok("Upstream Langfuse metrics JSON (loosely-typed passthrough).", { type: "object", additionalProperties: true }),
        403: { description: "A non-operator caller with no resolved ClusterTenant has no metrics scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        502: { description: "The Langfuse backend was unreachable or returned a non-2xx status.", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, error: { type: "string" } } } } } },
        503: { description: "The Langfuse backend is not configured (host/keys missing).", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" } } } } } },
      },
    },
  },
};
