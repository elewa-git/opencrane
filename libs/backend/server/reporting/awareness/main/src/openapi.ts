/**
 * OpenAPI paths for the awareness domain (contract rollout & fleet participation).
 */

// Helper response functions (import from spec)
function ok(description: string, schema: object): object
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

function notFound(description: string): object
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

/**
 * Awareness domain paths.
 * Exported as _AwarenessOpenapiPaths for composition in the main spec.
 */
/** OpenAPI path fragments owned by the awareness domain (composed into the opencrane-ui spec). */
export const _AwarenessOpenapiPaths = {
  "/awareness/rollout": {
    get: {
      operationId: "getAwarenessRollout",
      summary: "Show the fleet awareness contract rollout state",
      tags: ["Awareness Rollout"],
      responses: {
        200: ok("Current rollout state.", { $ref: "#/components/schemas/AwarenessRollout" }),
      },
    },
    put: {
      operationId: "setAwarenessRollout",
      summary: "Define (or redefine) the awareness rollout; resets the frontier",
      tags: ["Awareness Rollout"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetVersion"],
              properties: {
                targetVersion: { type: "string" },
                stableVersion: { type: "string" },
                waves: { type: "array", items: { type: "string" } },
                shadowMode: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        200: ok("Rollout defined.", { $ref: "#/components/schemas/AwarenessRollout" }),
      },
    },
  },
  "/awareness/rollout/promote": {
    post: {
      operationId: "promoteAwarenessRollout",
      summary: "Advance the rollout frontier (one wave, or up to a named wave)",
      tags: ["Awareness Rollout"],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", properties: { wave: { type: "string" } } },
          },
        },
      },
      responses: {
        200: ok("Frontier advanced.", { $ref: "#/components/schemas/AwarenessRollout" }),
      },
    },
  },
  "/awareness/rollout/rollback": {
    post: {
      operationId: "rollbackAwarenessRollout",
      summary: "One-step rollback: return every wave to the stable version",
      tags: ["Awareness Rollout"],
      responses: {
        200: ok("Rolled back.", { $ref: "#/components/schemas/AwarenessRollout" }),
      },
    },
  },
  "/awareness/rollout/resolve/{tenant}": {
    get: {
      operationId: "resolveAwarenessVersion",
      summary: "Resolve the awareness contract version a tenant runs",
      tags: ["Awareness Rollout"],
      parameters: [{ name: "tenant", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Resolved version.", {
          type: "object",
          properties: {
            tenant: { type: "string" },
            version: { type: "string" },
            promoted: { type: "boolean" },
            shadow: { type: "boolean" },
            wave: { type: "string" },
          },
        }),
        404: notFound("Tenant not found."),
      },
    },
  },
  "/awareness/participation": {
    get: {
      operationId: "getFleetParticipation",
      summary: "Fleet participation, drift, and policy-violation monitoring",
      tags: ["Awareness Rollout"],
      parameters: [{ name: "severity", in: "query", required: false, schema: { type: "string", enum: ["critical", "warning"] } }],
      responses: {
        200: ok("Fleet participation report.", {
          type: "object",
          properties: {
            total: { type: "integer" },
            participating: { type: "integer" },
            drifted: { type: "integer" },
            critical: { type: "integer" },
            warning: { type: "integer" },
            tenants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tenant: { type: "string" },
                  lastSeenAt: { type: "string", nullable: true },
                  runningContractVersion: { type: "string", nullable: true },
                  expectedContractVersion: { type: "string" },
                  participating: { type: "boolean" },
                  drifted: { type: "boolean" },
                  policyViolations: { type: "integer" },
                  severity: { type: "string", enum: ["ok", "warning", "critical"] },
                },
              },
            },
          },
        }),
      },
    },
  },
};
