// Common response helpers
function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by the projection domain (composed into the opencrane-ui spec). */
export const _ProjectionOpenapiPaths = {
  "/tenants/drift": {
    get: {
      operationId: "getTenantProjectionDrift",
      summary: "Detect drift between Tenant CRDs and PostgreSQL projection rows",
      tags: ["Tenants"],
      responses: {
        200: ok("Drift report.", { type: "object" }),
      },
    },
  },

  "/tenants/repair": {
    post: {
      operationId: "repairTenantProjection",
      summary: "Repair Tenant projection rows from CRD source of truth",
      tags: ["Tenants"],
      parameters: [
        { name: "dryRun", in: "query", schema: { type: "boolean", default: true }, description: "When true (default), report planned changes without applying them." },
      ],
      responses: {
        200: ok("Repair report.", { type: "object" }),
      },
    },
  },

  "/policies/drift": {
    get: {
      operationId: "getPolicyProjectionDrift",
      summary: "Detect drift between AccessPolicy CRDs and PostgreSQL projection rows",
      tags: ["Policies"],
      responses: {
        200: ok("Drift report.", { type: "object" }),
      },
    },
  },

  "/policies/repair": {
    post: {
      operationId: "repairPolicyProjection",
      summary: "Repair AccessPolicy projection rows from CRD source of truth",
      tags: ["Policies"],
      parameters: [
        { name: "dryRun", in: "query", schema: { type: "boolean", default: true } },
      ],
      responses: {
        200: ok("Repair report.", { type: "object" }),
      },
    },
  },
};
