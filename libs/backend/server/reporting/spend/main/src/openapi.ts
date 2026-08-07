// Common response helpers
function notFound(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function upstreamError()
{
  return {
    description: "Upstream dependency (Kubernetes, database, Cognee, LiteLLM) returned an error.",
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

/** OpenAPI path fragments owned by the spend domain (composed into the opencrane-ui spec). */
export const _SpendOpenapiPaths = {
  "/ai-budget/global": {
    get: {
      operationId: "getGlobalBudget",
      summary: "Get global monthly spend ceiling",
      tags: ["AI Budget"],
      responses: {
        200: ok("Global budget.", { $ref: "#/components/schemas/Budget" }),
      },
    },
    put: {
      operationId: "updateGlobalBudget",
      summary: "Update the global monthly spend ceiling",
      tags: ["AI Budget"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["monthlyLimitUsd"], properties: { monthlyLimitUsd: { type: "number" } } } } },
      },
      responses: {
        200: ok("Global budget updated.", { $ref: "#/components/schemas/Budget" }),
      },
    },
  },

  "/ai-budget/accounts": {
    get: {
      operationId: "listAccountBudgets",
      summary: "List all per-account monthly spend ceilings",
      tags: ["AI Budget"],
      responses: {
        200: ok("Account budgets.", { type: "array", items: { $ref: "#/components/schemas/Budget" } }),
      },
    },
  },

  "/ai-budget/accounts/{userId}": {
    put: {
      operationId: "upsertAccountBudget",
      summary: "Create or update the budget ceiling for a specific account",
      tags: ["AI Budget"],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["monthlyLimitUsd"], properties: { monthlyLimitUsd: { type: "number" } } } } },
      },
      responses: {
        200: ok("Account budget updated.", { $ref: "#/components/schemas/Budget" }),
      },
    },
    delete: {
      operationId: "deleteAccountBudget",
      summary: "Remove the per-account budget ceiling",
      tags: ["AI Budget"],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Budget removed.", { type: "object" }),
      },
    },
  },

};
