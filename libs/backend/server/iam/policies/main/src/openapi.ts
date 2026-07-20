// Common response helpers
function notFound(description: string)
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

function created(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by the policies domain (composed into the opencrane-ui spec). */
export const _PoliciesOpenapiPaths = {
  "/policies": {
    get: {
      operationId: "listPolicies",
      summary: "List all access policies",
      tags: ["Policies"],
      responses: {
        200: ok("Policy list.", { type: "array", items: { $ref: "#/components/schemas/Policy" } }),
      },
    },
    post: {
      operationId: "createPolicy",
      summary: "Create an access policy (dual-write: K8s CRD + database)",
      tags: ["Policies"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        201: created("Policy created.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },

  "/policies/{name}": {
    get: {
      operationId: "getPolicy",
      summary: "Get a single access policy by name",
      tags: ["Policies"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Policy detail.", { $ref: "#/components/schemas/Policy" }),
        404: notFound("Policy not found."),
      },
    },
    put: {
      operationId: "updatePolicy",
      summary: "Update an access policy",
      tags: ["Policies"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: ok("Policy updated.", { type: "object" }),
      },
    },
    delete: {
      operationId: "deletePolicy",
      summary: "Delete an access policy",
      tags: ["Policies"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Policy deleted.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },
};
